import { Router, type IRouter } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { db, memoriesTable, profilesTable } from "@workspace/db";

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
 * Auth: a static shared secret (MCP_BRIDGE_SECRET env var), checked via
 * `Authorization: Bearer <secret>` -- NOT Clerk. A phone call has no Clerk
 * session, so this deliberately bypasses requireAuth and instead relies on
 * the secret being known only to this server and x.ai's connector config.
 *
 * Single-user assumption: this app currently has exactly one profile (Don's
 * own account). Rather than solve caller-ID-to-profile mapping (which would
 * need a schema change -- out of scope for this pass, and schema changes
 * need Don's explicit sign-off separately), this bridge just operates on
 * the first profile row. Revisit if this app ever needs multiple users.
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

const TOOLS = [
  {
    name: "get_memories",
    description:
      "Fetch remembered facts about the account owner (Don) from past companion conversations -- names of people in his life, ongoing situations, preferences, goals, recurring concerns. Call this at the start of a call to personalize the conversation the way the text/voice app already does.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "save_memory",
    description:
      "Save a new durable, worth-remembering fact learned during this call, so future calls and the companion app both recall it. Only call for genuinely durable facts (names, ongoing situations, preferences, goals, recurring concerns) -- not small talk.",
    inputSchema: {
      type: "object",
      properties: {
        fact: {
          type: "string",
          description: "A short, standalone factual statement worth remembering long-term.",
        },
      },
      required: ["fact"],
    },
  },
];

async function getFirstProfile() {
  // `.limit(1)` with no ORDER BY is nondeterministic -- Postgres is free to
  // return rows in whatever order it finds convenient, which can change
  // between queries. Ordering by createdAt makes "first" mean something
  // concrete (the oldest account, i.e. the one made when Don first set the
  // app up) instead of "whichever row Postgres felt like returning."
  const [profile] = await db.select().from(profilesTable).orderBy(asc(profilesTable.createdAt)).limit(1);
  return profile;
}

async function handleToolCall(name: string, args: Record<string, unknown> | undefined) {
  if (name === "get_memories") {
    const profile = await getFirstProfile();
    if (!profile) {
      return { content: [{ type: "text", text: "No profile found yet -- nothing remembered." }] };
    }
    const memories = await db
      .select()
      .from(memoriesTable)
      .where(eq(memoriesTable.userId, profile.userId))
      .orderBy(desc(memoriesTable.createdAt));
    const text =
      memories.length === 0
        ? "No remembered facts yet."
        : memories.map((m) => `- ${m.content}`).join("\n");
    return { content: [{ type: "text", text }] };
  }

  if (name === "save_memory") {
    const fact = typeof args?.fact === "string" ? args.fact.trim() : "";
    if (!fact) {
      return { content: [{ type: "text", text: "No fact provided, nothing saved." }], isError: true };
    }
    const profile = await getFirstProfile();
    if (!profile) {
      return { content: [{ type: "text", text: "No profile found yet -- could not save." }], isError: true };
    }
    await db.insert(memoriesTable).values({ userId: profile.userId, content: fact });
    return { content: [{ type: "text", text: "Saved." }] };
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
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
          serverInfo: { name: "ai-counselor-memory-bridge", version: "1.0.0" },
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
