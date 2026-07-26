import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, memoriesTable, profilesTable, conversationsTable, messagesTable } from "@workspace/db";
import {
  getProfileByAccessCode,
  createProfileForAccessCode,
  PHONE_ACCESS_CODE_PATTERN,
  isPhoneBridgeLockedOut,
  recordFailedPhoneBridgeAttempt,
  clearFailedPhoneBridgeAttempts,
} from "../lib/phoneAccess";
import { findOwnedConversation } from "./conversations/shared";

/**
 * MCP bridge for the phone-based Grok voice agent (hosted entirely on x.ai's
 * own platform, outside this codebase). That agent has zero visibility into
 * this app's Postgres by default -- this route exposes a minimal
 * Model-Context-Protocol server over Streamable HTTP so it can be wired in
 * via x.ai's console: Voice > Agents > [agent] > Connectors > Add connector
 * > Custom MCP server, pointing at this route's URL.
 *
 * Hand-implemented against the MCP spec (JSON-RPC 2.0 over a single POST
 * endpoint) rather than pulling in @modelcontextprotocol/sdk, specifically
 * to avoid touching pnpm-lock.yaml / adding a new dependency under time
 * pressure -- this is a small, self-contained protocol surface.
 *
 * Auth: two layers, both required.
 * 1. A static shared secret (MCP_BRIDGE_SECRET env var), checked via
 *    `Authorization: Bearer <secret>` -- proves the caller is x.ai's
 *    connector, not Clerk (a phone call has no Clerk session).
 * 2. A per-account 6-digit phone access code (profiles.phoneAccessCodeHash),
 *    passed as `access_code` on every tool call and looked up via
 *    getProfileByAccessCode. This is the actual "which account is this call
 *    for" identity -- the bridge secret alone only proves "this is x.ai
 *    calling," not which caller's account to use. Stateless by design (no
 *    server-side session/call tracking): the model is expected to collect
 *    the code once at the start of the call, then silently attach it to
 *    every subsequent tool call for the rest of that call, the same way
 *    it's expected to remember conversation_id after verify_caller. See
 *    AGENTS.md for the exact system-prompt wiring.
 *
 *    A code can come from Settings -> Phone Access Code (an existing Clerk
 *    account opting in), OR be self-registered: if verify_caller is given a
 *    well-formed code that doesn't match anything, it creates a brand-new,
 *    phone-only account for it on the spot (createProfileForAccessCode) and
 *    reports is_new_account so the agent knows to ask the caller's name.
 *    This means verify_caller itself never "fails" a well-formed code --
 *    there's no such thing as a wrong code, only an unclaimed one -- so
 *    brute-force lockout doesn't apply there. It still applies to every
 *    OTHER tool, which require a code that's already resolved to a profile
 *    (i.e., a call that skipped verify_caller, or a stale/malformed code).
 *
 * Voice-profile matching: xAI's Voice Agent tool-calling is text-only --
 * arguments are derived from the transcript, and there is no documented way
 * for the model to pass raw call audio into a function argument, nor a
 * webhook/export mechanism for this server to receive call audio
 * out-of-band (confirmed against xAI's docs, not assumed). True
 * voice-biometric caller identification (matching this app's existing
 * `identifyOrEnrollSpeaker` / voiceProfiles, which the web app already does
 * with real audio) is therefore not achievable over this integration. What
 * IS achievable, and what log_message's speaker_name argument does: the
 * same self-reported-name pattern speaker.ts already uses as its fallback
 * (introducedName, e.g. "Hi, I'm Sarah") -- Anna asks or infers who's
 * speaking and tags it, same as the app's existing per-message speakerName
 * column, just without an audio-backed voiceProfiles enrollment behind it.
 */

const router: IRouter = Router();

const MCP_BRIDGE_SECRET = process.env.MCP_BRIDGE_SECRET;
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolText(text: string, isError = false) {
  return isError ? { content: [{ type: "text", text }], isError: true } : { content: [{ type: "text", text }] };
}

const ACCESS_CODE_PROPERTY = {
  access_code: {
    type: "string",
    description: "The caller's 6-digit phone access code, collected once at the start of the call and reused on every tool call for its duration.",
  },
} as const;

const TOOLS = [
  {
    name: "verify_caller",
    description:
      "Identify which account this call belongs to, using the 6-digit phone access code the caller gives you. Call this FIRST, before anything else -- every other tool needs the account it identifies. If the code doesn't match an existing account, a brand-new one is created for it automatically -- the response's is_new_account will be true and preferred_name will be empty, which means you should warmly ask the caller their name next and save it with set_caller_name. Starts a new call record (like a conversation in the app) and returns its conversation_id, which you must include on every log_message call for the rest of this call.",
    inputSchema: {
      type: "object",
      properties: ACCESS_CODE_PROPERTY,
      required: ["access_code"],
    },
  },
  {
    name: "set_caller_name",
    description:
      "Save the caller's name to their account. Call this once, right after verify_caller, whenever is_new_account was true or preferred_name came back empty -- ask warmly what they'd like to be called, then save their answer here.",
    inputSchema: {
      type: "object",
      properties: {
        ...ACCESS_CODE_PROPERTY,
        name: { type: "string", description: "The name the caller wants to be called." },
      },
      required: ["access_code", "name"],
    },
  },
  {
    name: "get_memories",
    description:
      "Fetch remembered facts about the account owner from past companion conversations -- names of people in their life, ongoing situations, preferences, goals, recurring concerns. Call this after verify_caller to personalize the conversation the way the text/voice app already does.",
    inputSchema: {
      type: "object",
      properties: ACCESS_CODE_PROPERTY,
      required: ["access_code"],
    },
  },
  {
    name: "save_memory",
    description:
      "Save a new durable, worth-remembering fact learned during this call, so future calls and the companion app both recall it. Only call for genuinely durable facts (names, ongoing situations, preferences, goals, recurring concerns) -- not small talk.",
    inputSchema: {
      type: "object",
      properties: {
        ...ACCESS_CODE_PROPERTY,
        fact: {
          type: "string",
          description: "A short, standalone factual statement worth remembering long-term.",
        },
      },
      required: ["access_code", "fact"],
    },
  },
  {
    name: "log_message",
    description:
      "Record one turn of this call's transcript, so the call shows up in the app's History alongside text and web-voice conversations. Call this after EVERY turn -- both what the caller said (role=user) and what you said back (role=assistant) -- using the conversation_id verify_caller gave you. If you know who's speaking (they introduced themselves, or you recognize the household voice by name from earlier in the call), pass speaker_name -- this is a self-reported name, not voice-biometric identification, so only set it when the caller has actually identified themselves.",
    inputSchema: {
      type: "object",
      properties: {
        ...ACCESS_CODE_PROPERTY,
        conversation_id: { type: "integer", description: "The conversation_id returned by verify_caller." },
        role: { type: "string", enum: ["user", "assistant"], description: "Who said this line." },
        content: { type: "string", description: "What was said." },
        speaker_name: {
          type: "string",
          description: "Self-reported name of the person speaking (role=user only), if known. Omit if unknown.",
        },
      },
      required: ["access_code", "conversation_id", "role", "content"],
    },
  },
];

async function handleToolCall(name: string, args: Record<string, unknown> | undefined) {
  const accessCode = typeof args?.access_code === "string" ? args.access_code.trim() : "";
  if (!accessCode) {
    return toolText("No access_code provided. Ask the caller for their 6-digit phone access code and call verify_caller with it first.", true);
  }
  if (!PHONE_ACCESS_CODE_PATTERN.test(accessCode)) {
    return toolText("A phone access code is exactly 6 digits. Ask the caller to repeat theirs.", true);
  }

  if (name === "verify_caller") {
    let profile = await getProfileByAccessCode(accessCode);
    let isNewAccount = false;
    if (!profile) {
      profile = await createProfileForAccessCode(accessCode);
      isNewAccount = true;
    }

    const [conversation] = await db
      .insert(conversationsTable)
      .values({
        userId: profile.userId,
        title: `Phone call — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      })
      .returning();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            conversation_id: conversation.id,
            is_new_account: isNewAccount,
            preferred_name: profile.preferredName,
            companion_name: profile.companionName,
            wait_for_keyword: profile.keywordModeEnabled,
            keyword: profile.keywordWord,
          }),
        },
      ],
    };
  }

  // Every other tool needs a code that's already resolved to a real
  // account. Unlike verify_caller (which self-registers an unclaimed code
  // rather than ever failing), a not-found code here means the model
  // skipped verify_caller or is holding a stale/malformed code -- worth
  // rate-limiting, since it's the one path where repeated guesses could
  // probe for existing accounts.
  if (isPhoneBridgeLockedOut()) {
    return toolText("Too many unrecognized codes recently -- try again later.", true);
  }
  const profile = await getProfileByAccessCode(accessCode);
  if (!profile) {
    recordFailedPhoneBridgeAttempt();
    return toolText("That code isn't verified yet -- call verify_caller with it first.", true);
  }
  clearFailedPhoneBridgeAttempts();

  if (name === "set_caller_name") {
    const callerName = typeof args?.name === "string" ? args.name.trim() : "";
    if (!callerName) return toolText("No name provided, nothing saved.", true);
    await db.update(profilesTable).set({ preferredName: callerName }).where(eq(profilesTable.userId, profile.userId));
    return toolText(`Saved -- I'll call you ${callerName}.`);
  }

  if (name === "get_memories") {
    const memories = await db
      .select()
      .from(memoriesTable)
      .where(eq(memoriesTable.userId, profile.userId))
      .orderBy(desc(memoriesTable.createdAt));
    const text = memories.length === 0 ? "No remembered facts yet." : memories.map((m) => `- ${m.content}`).join("\n");
    return toolText(text);
  }

  if (name === "save_memory") {
    const fact = typeof args?.fact === "string" ? args.fact.trim() : "";
    if (!fact) return toolText("No fact provided, nothing saved.", true);
    await db.insert(memoriesTable).values({ userId: profile.userId, content: fact });
    return toolText("Saved.");
  }

  if (name === "log_message") {
    const conversationId = typeof args?.conversation_id === "number" ? args.conversation_id : null;
    const role = args?.role === "user" || args?.role === "assistant" ? args.role : null;
    const content = typeof args?.content === "string" ? args.content.trim() : "";
    const speakerName = typeof args?.speaker_name === "string" && args.speaker_name.trim() ? args.speaker_name.trim() : null;

    if (!conversationId || !role || !content) {
      return toolText("Missing conversation_id, role, or content -- nothing logged.", true);
    }

    const conversation = await findOwnedConversation(conversationId, profile.userId);
    if (!conversation) {
      return toolText("That conversation_id doesn't belong to this account -- call verify_caller again to get a fresh one.", true);
    }

    await db.insert(messagesTable).values({
      conversationId,
      role,
      content,
      speakerName: role === "user" ? speakerName : null,
    });
    return toolText("Logged.");
  }

  return toolText(`Unknown tool: ${name}`, true);
}

// The Streamable HTTP spec lets clients open a standalone GET/SSE stream for
// server-initiated messages, and lets them DELETE to end a session -- both
// optional, and this server (stateless, no server-initiated messages) does
// neither. A spec-compliant client is supposed to treat "no support" as a
// clean 405, not an error -- but Express's *default* handler for an
// undeclared method on an undeclared route is a bare 404 HTML page, which
// reads as "nothing is here" rather than "this exists, that method isn't
// supported." Some MCP clients do an initial reachability probe before ever
// sending POST /initialize, and a 404 there can surface to the user as
// "Couldn't reach this MCP server" even though POST works perfectly fine.
router.get("/mcp/bridge", (_req, res): void => {
  res.status(405).json(rpcError(null, -32000, "This MCP server does not support server-initiated SSE streams (GET) -- use POST."));
});

router.delete("/mcp/bridge", (_req, res): void => {
  res.status(405).json(rpcError(null, -32000, "This MCP server is stateless and has no sessions to terminate (DELETE)."));
});

router.post("/mcp/bridge", async (req, res): Promise<void> => {
  if (!MCP_BRIDGE_SECRET) {
    res.status(500).json(rpcError(null, -32000, "MCP_BRIDGE_SECRET not configured on server"));
    return;
  }

  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (token !== MCP_BRIDGE_SECRET) {
    res.status(401).json(rpcError(null, -32001, "Unauthorized"));
    return;
  }

  const body = req.body as JsonRpcRequest;
  const { id, method, params } = body ?? {};

  try {
    if (method === "initialize") {
      // Echo back whatever protocolVersion the client asked for rather than
      // pinning one: this server has no version-specific behavior, so any
      // requested date-string is fine, and pinning one (the previous value,
      // "2024-11-05", predates the Streamable HTTP transport this route
      // actually implements -- introduced in 2025-03-26) only risks a strict
      // client rejecting the mismatch. DEFAULT_PROTOCOL_VERSION covers
      // clients that omit the field on initialize.
      const requestedVersion = params?.protocolVersion;
      res.json(
        rpcResult(id, {
          protocolVersion: typeof requestedVersion === "string" ? requestedVersion : DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "ai-counselor-memory-bridge", version: "2.0.0" },
        }),
      );
      return;
    }

    if (method === "notifications/initialized") {
      // Notification -- no response body expected, per JSON-RPC spec.
      res.status(202).end();
      return;
    }

    if (method === "tools/list") {
      res.json(rpcResult(id, { tools: TOOLS }));
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name as string | undefined;
      const toolArgs = params?.arguments as Record<string, unknown> | undefined;
      if (!toolName) {
        res.json(rpcError(id, -32602, "Missing tool name"));
        return;
      }
      const result = await handleToolCall(toolName, toolArgs);
      res.json(rpcResult(id, result));
      return;
    }

    res.json(rpcError(id, -32601, `Method not found: ${method}`));
  } catch (err) {
    res.status(500).json(rpcError(id, -32000, `Internal error: ${String(err)}`));
  }
});

export default router;
