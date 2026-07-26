# AI-Counselor

pnpm monorepo. "Aura" — a warm, voice-first AI companion web app (and phone line, see below). Users talk (and type) with a calm, grounded companion persona who remembers what they share and responds with spoken audio. It is explicitly not a licensed therapist or crisis service.

## Commands

- `pnpm run typecheck` — typecheck all packages (run `tsc --build` project refs)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run dev` — run API server (Railway deploy target)
- `pnpm --filter @workspace/ai-therapist run dev` — run web frontend (Vercel deploy target)
- `pnpm --filter @workspace/db run push` — push DB schema to dev database
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client/hooks from OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, deployed on Railway
- DB: PostgreSQL (Railway-hosted) + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)
- Auth: Clerk (`@clerk/express`, `@clerk/react`)
- LLM: free-tier provider fallback chain (Cerebras/Groq/Kilo Code/Mistral/Qwen Cloud), wrapped in `lib/gemini` (name is legacy — Gemini was removed from the main chat path 2026-07-21; see `lib/gemini/src/fallback.ts`)
- Voice (web app): Deepgram via the user's own `DEEPGRAM_API_KEY` (`@deepgram/sdk` v5), wrapped in `lib/deepgram`; also a native browser Web Speech API path (no server round-trip) and an opt-in Grok/xAI streaming STT+TTS beta (`lib/grok-voice`)
- Voice (phone line): a separate, fully-hosted xAI Voice Agent (console.x.ai) — outside this codebase's audio pipeline entirely; connects back into this app via an MCP bridge, see below

## Architecture

**Third-party SDKs are wrapped in `lib/` workspace packages:**
- `lib/gemini/` — LLM fallback chain + Gemini client (multimodal audio speaker-ID only now; requires GEMINI_API_KEY for that one feature)
- `lib/deepgram/` — `@deepgram/sdk` v5 fern-generated wrapper (requires DEEPGRAM_API_KEY)
- `lib/grok-voice/` — xAI streaming STT/TTS wrapper (requires XAI_API_KEY)
- `lib/db/` — Drizzle ORM + PostgreSQL

**Do NOT add third-party SDKs as direct dependencies of `api-server`.** Always wrap in a `lib/<service>` package first.

**esbuild `external` globs in `artifacts/api-server/build.mjs` must NOT match workspace-wrapped SDKs:** `@google/*` would incorrectly externalize `@google/genai` causing runtime ERR_MODULE_NOT_FOUND.

## Where things live

- `lib/db/src/schema/` — `profiles`, `conversations`, `messages`, `memories`, `voiceProfiles` tables
- `lib/gemini/` — LLM fallback chain (`fallback.ts`), companion persona/system-instruction builder (`persona.ts`), chat + memory-extraction calls (`index.ts`), Gemini-based multimodal speaker-ID (`speaker.ts`)
- `lib/deepgram/` — Deepgram client, speech-to-text and text-to-speech helpers
- `lib/api-spec/openapi.yaml` — source of truth for the API contract
- `artifacts/api-server/src/routes/` — Express routes (profile, stats, memories, conversations + nested messages/voice-messages, history, mcpBridge)
- `artifacts/api-server/src/lib/companionExchange.ts` — shared turn logic: generate reply with persona/history/memories → persist user + assistant messages → background memory extraction
- `artifacts/api-server/src/routes/mcpBridge.ts` — MCP server (Streamable HTTP, hand-rolled JSON-RPC) exposing this app's memories/conversations to the phone-hosted xAI Voice Agent; auth via `MCP_BRIDGE_SECRET` bearer token, not Clerk
- `artifacts/ai-therapist/` — React + Vite frontend

## Architecture decisions

- LLM and voice both use directly-configured API keys (set as Railway environment variables), via hand-written thin SDK wrapper packages in `lib/`.
- Chat and voice endpoints (Deepgram path) are non-streaming JSON responses — a deliberate simplicity/robustness tradeoff for the STT → LLM → TTS chain, at the cost of perceived latency. The Web Speech and Grok streaming paths are real-time.
- Memory (`memories` table) is scoped to account identity + facts the user has explicitly shared in conversation.
- Voice-profile speaker identification (`voiceProfiles` table, `identifyOrEnrollSpeaker`) is a separate, best-effort feature using Gemini's multimodal audio understanding — not biometric-grade, suitable for distinguishing a handful of household voices, not cryptographic identification. See `.agents/memory/voice-profiles.md`.
- Post-exchange memory extraction runs fire-and-forget after the reply is sent; failures are swallowed so a flaky extraction never breaks the visible reply.
- The LLM fallback chain is walked in priority order (currently: strongest free reasoners first, one paid provider pinned last) with a per-provider timeout and a hard ceiling on the whole walk, so a fully-dead chain fails fast with a speakable error instead of hanging. `GET /api/healthz/llm` probes every configured provider live and reports which answer — use this first when the companion stops replying, before guessing.

## Product

- Voice-first conversational companion: record a voice message, get a spoken reply back, with text chat as a fallback.
- Persistent memory: the companion recalls durable facts across conversations and sessions, scoped per Clerk account.
- Conversation history: multiple named conversations per user, browsable via a dedicated History page and deletable. Users can set an optional History PIN (Settings → History PIN) — separate from their account password — that must be entered before the History page's conversation list loads. See `lib/api-spec/openapi.yaml` (`history` tag) and `artifacts/api-server/src/lib/historyAccess.ts`.
- Live voice turn-taking: by default the browser's own speech endpointing decides when a turn ends (silence-based). Users can instead opt into "wait for a keyword" mode (`live-conversation.tsx`), which keeps listening through pauses until a spoken keyword (default "over") ends the turn — useful for anyone who pauses mid-thought.
- Phone line: a real phone number, hosted entirely on xAI's Voice Agent platform, backed by the same memories/conversations via the MCP bridge. Callers identify their account with a 6-digit phone access code (Settings → Phone Access Code) — the phone-side equivalent of a Clerk session, since a phone call has no browser session to authenticate with.
- Crisis-language safeguards are built into the persona's system instruction, not just UI copy.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `@deepgram/sdk` v5 is fern-generated — structurally different from v3. Check installed `.d.ts` files, not docs.
- `@google/genai` must NOT be in esbuild's external list; it's a pure-JS fetch SDK that bundles correctly.
- Required secrets: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `SESSION_SECRET`, `MCP_BRIDGE_SECRET`, plus whichever LLM/voice provider keys are configured (see `lib/gemini/src/fallback.ts` for the full provider list — each is optional and skipped if its key is unset).
- `profiles.historyPinHash` (added for the History PIN feature) requires `pnpm --filter @workspace/db run push` (or the equivalent hand-written DDL against the production DB) before the API server will start cleanly against it. Same applies to any new `profiles`/`conversations`/`messages` columns added later — this app's production DB is on Railway, not auto-migrated on deploy.
- The History PIN gate only protects `GET /conversations` (the browsing/list surface). Opening a specific conversation by id, or its messages, stays ungated — needed so an active/just-created chat keeps working without re-entering the PIN. This is a deliberate scope decision, not an oversight.
- The MCP bridge (`mcpBridge.ts`) is a hand-rolled Streamable HTTP JSON-RPC server, not `@modelcontextprotocol/sdk` — kept deliberately dependency-free. `GET`/`DELETE` on its route must return a clean `405`, not fall through to Express's default 404 — some MCP clients probe reachability with `GET` before ever sending `POST /initialize`, and a bare 404 there reads as "server doesn't exist" rather than "method not supported."
- xAI's Voice Agent tool-calling is **text-only**: a tool call's arguments are derived from the transcript, and there is no documented way for the model to pass raw call audio into a function argument, nor a webhook/export mechanism for a third-party server to receive call audio out-of-band. This rules out true voice-biometric caller identification over the phone line under the current integration (MCP tool-calling) — confirmed against xAI's own docs, not assumed.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
