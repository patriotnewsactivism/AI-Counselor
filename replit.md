# AI-Therapist

A warm, voice-first AI companion web app. Users talk (and type) with a calm, grounded companion persona who remembers what they share and responds with spoken audio. It is explicitly not a licensed therapist or crisis service.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/ai-therapist run dev` — run the web frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secrets: `DATABASE_URL`, `GEMINI_API_KEY`, `DEEPGRAM_API_KEY`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)
- Auth: Replit-managed Clerk (`@clerk/express`, `@clerk/react`)
- LLM: Google Gemini via the user's own `GEMINI_API_KEY` (`@google/genai`), wrapped in `lib/gemini`
- Voice: Deepgram via the user's own `DEEPGRAM_API_KEY` (`@deepgram/sdk` v5), wrapped in `lib/deepgram`

## Where things live

- `lib/db/src/schema/` — `profiles`, `conversations`, `messages`, `memories` tables
- `lib/gemini/` — Gemini client, companion persona/system-instruction builder, chat + memory-extraction calls
- `lib/deepgram/` — Deepgram client, speech-to-text and text-to-speech helpers
- `lib/api-spec/openapi.yaml` — source of truth for the API contract
- `artifacts/api-server/src/routes/` — Express routes (profile, stats, memories, conversations + nested messages/voice-messages)
- `artifacts/api-server/src/lib/companionExchange.ts` — shared turn logic: save user message → generate reply with persona/history/memories → save reply → background memory extraction
- `artifacts/ai-therapist/` — React + Vite frontend

## Architecture decisions

- LLM and voice both use the user's own API keys directly (not the Replit AI proxy), via hand-written thin SDK wrapper packages in `lib/`.
- Chat and voice endpoints are non-streaming JSON responses — a deliberate simplicity/robustness tradeoff for the STT → LLM → TTS chain, at the cost of perceived latency.
- Memory (`memories` table) is scoped to account identity + facts the user has explicitly shared in conversation — never biometric voice recognition. This must stay clearly communicated in the UI (see `/memories` page).
- Post-exchange memory extraction runs fire-and-forget after the reply is sent; failures are swallowed so a flaky extraction never breaks the visible reply.

## Product

- Voice-first conversational companion: record a voice message, get a spoken reply back (Deepgram STT → Gemini → Deepgram TTS), with text chat as a fallback.
- Persistent memory: the companion recalls durable facts across conversations and sessions, scoped per Clerk account.
- Conversation history: multiple named conversations per user, browsable via a dedicated History page and deletable. Users can set an optional History PIN (Settings → History PIN) — separate from their account password — that must be entered before the History page's conversation list loads. See `lib/api-spec/openapi.yaml` (`history` tag) and `artifacts/api-server/src/lib/historyAccess.ts`.
- Live voice turn-taking: by default the browser's own speech endpointing decides when a turn ends (silence-based). Users can instead opt into "wait for a keyword" mode (`live-conversation.tsx`), which keeps listening through pauses until a spoken keyword (default "over") ends the turn — useful for anyone who pauses mid-thought.
- Crisis-language safeguards are built into the persona's system instruction, not just UI copy.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `@deepgram/sdk` v5 is a fern-generated SDK, structurally unrelated to older v3 docs/examples — always check the installed `.d.ts` files directly rather than trusting prior knowledge (see `.agents/memory/deepgram-sdk-v5.md`).
- `build.mjs`'s esbuild `external` list globs `@google-cloud/*` but must NOT glob `@google/*` — that would also externalize `@google/genai`, which then fails to resolve at runtime since it's not a direct dependency of `api-server`.
- `profiles.historyPinHash` (added for the History PIN feature) requires `pnpm --filter @workspace/db run push` against the dev database before the API server will start cleanly against it.
- The History PIN gate only protects `GET /conversations` (the browsing/list surface). Opening a specific conversation by id, or its messages, stays ungated — needed so an active/just-created chat keeps working without re-entering the PIN. This is a deliberate scope decision, not an oversight.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
