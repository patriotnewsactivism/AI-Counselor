# AI-Counselor

pnpm monorepo. See `replit.md` for full product documentation.

## Commands

- `pnpm run typecheck` — typecheck all packages (runs `tsc --build` project refs + per-artifact `tsc --noEmit`)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run dev` — run API server (Railway deploy target)
- `pnpm --filter @workspace/ai-therapist run dev` — run web frontend (Vercel deploy target)
- `pnpm --filter @workspace/db run push` — push DB schema to dev database
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client/hooks from OpenAPI spec

## Architecture

**Voice-first AI companion web app.** Users talk (and type) with a calm, grounded companion persona who remembers what they share and responds with spoken audio. Explicitly not a licensed therapist or crisis service.

### Monorepo layout

- `artifacts/api-server/` — Express 5 API server (Railway deploy target, esbuild ESM bundle)
- `artifacts/ai-therapist/` — React 19 + Vite frontend (Vercel deploy target, shadcn/ui new-york, wouter routing)
- `lib/db/` — Drizzle ORM + PostgreSQL (schema, connection pool, Zod insert schemas via `drizzle-zod`)
- `lib/gemini/` — `@google/genai` wrapper; **only used for speaker identification** (multimodal audio). Companion text replies no longer use Gemini.
- `lib/deepgram/` — `@deepgram/sdk` v5 wrapper; one-shot STT (Nova-3) + TTS (Aura-2) for the HTTP voice route
- `lib/grok-voice/` — xAI Grok streaming STT (WebSocket) + TTS (REST) for the WebSocket voice pipeline
- `lib/api-spec/` — OpenAPI spec + Orval config (source of truth for API contract)
- `lib/api-client-react/` — generated React Query hooks + custom fetch wrapper (from Orval codegen)
- `lib/api-zod/` — generated Zod schemas + TypeScript types (from Orval codegen)
- `scripts/` — workspace utility scripts (tsx runner)

### LLM provider chain

Companion text replies use a **multi-provider fallback chain** (in `lib/gemini/src/fallback.ts`), not Gemini. All providers expose OpenAI-compatible `/chat/completions` endpoints. Priority order:

1. **Groq** (`GROQ_API_KEY`, `llama-3.3-70b-versatile`) — fast, generous free tier
2. **Cerebras** (`CEREBRAS_API_KEY`, `llama3.1-8b`) — equally fast, separate infra
3. **Mistral** (`MISTRAL_API_KEY`, `mistral-small-latest`) — large token budget
4. **Kilo Code** (`KILOCODE_API_KEY`) — proxies OpenRouter model catalog (must use `kilo.ai` host, NOT `kilocode.ai` — old host 308-redirects and silently eats POST bodies)
5. **Qwen Cloud** (`QWENCLOUD_API_KEY`, `qwen3-coder-plus`) — PAID pay-as-you-go, last resort only

Gemini was removed from the companion reply path on 2026-07-21 because its free-tier RPM/RPD cap caused repeated rate-limit errors during voice chats. Gemini remains only for `identifyOrEnrollSpeaker()` in `lib/gemini/src/speaker.ts`.

### Two voice paths

1. **One-shot HTTP** (`POST /api/conversations/:id/voice-messages`) — Deepgram Nova-3 STT → LLM reply (pipelined, per-sentence) → Deepgram Aura-2 TTS. Returns one concatenated audio blob. Client uploads a full recording.
2. **Streaming WebSocket** (`/ws/voice-stream`) — Grok STT (WebSocket, real-time PCM in) → LLM reply (pipelined, per-sentence) → Grok TTS (per-sentence audio frames out). Persistent duplex connection, barge-in support. Auth via Clerk Bearer token passed as query param (browser WebSocket can't send custom headers).

Both paths share the same companion logic: `getOrCreateProfile` → `identifyOrEnrollSpeaker` → `runCompanionExchangePipelined`.

### Companion exchange pipeline

`artifacts/api-server/src/lib/companionExchange.ts` — shared turn logic:
1. Load last 20 messages as history + existing memories
2. Save user message to DB
3. Generate reply via `generateCompanionReplyPipelined` (streams, calls `onSentence` per sentence)
4. Save assistant reply to DB
5. Fire-and-forget memory extraction (failures swallowed, never blocks the reply)

### API contract & codegen

- `lib/api-spec/openapi.yaml` is the source of truth
- `pnpm --filter @workspace/api-spec run codegen` regenerates:
  - `lib/api-client-react/src/generated/` — React Query hooks (split mode, custom fetch mutator)
  - `lib/api-zod/src/generated/` — Zod schemas + TypeScript types
- The frontend imports API hooks from `@workspace/api-client-react`; the server imports Zod schemas from `@workspace/api-zod` for request/response validation

### Auth

Clerk (`@clerk/express` on server, `@clerk/react` on frontend). Cross-origin: frontend (Vercel) sends Clerk session Bearer token on every API call (cookies don't work cross-origin). WebSocket auth injects the Bearer token as a query param, then rewrites it to an `Authorization` header before Clerk verification.

### DB schema

`lib/db/src/schema/` — five tables:
- `profiles` — per-Clerk-user companion config (companionName default "Clara", preferredName, wake word settings)
- `conversations` — named conversations per user
- `messages` — chat messages (role, content, optional audioMimeType + speakerName for voice)
- `memories` — durable facts scoped per Clerk account (not biometric)
- `voiceProfiles` — enrolled voice samples (base64) for multi-speaker recognition

## SDK wrapper convention

**Third-party SDKs are wrapped in `lib/<service>/` workspace packages, never imported directly in `api-server`.** Each wrapper:
- Has `src/client.ts` (constructs client from env var, throws clearly if missing)
- Has `src/index.ts` (exports only the operations used by routes)
- Is a workspace dependency (`@workspace/<service>`) of the consuming artifact
- The raw third-party SDK is NOT a direct dependency of `api-server`

## Conventions

- **TypeScript:** ESM throughout, `moduleResolution: "bundler"`, `target: es2022`. Project references via root `tsconfig.json`. Per-package `tsconfig.json` extends `tsconfig.base.json`.
- **Validation:** Zod (`zod/v4`), `drizzle-zod` for insert schemas. Routes validate input with `.safeParse()` and return 400 on failure.
- **Logging:** Pino (`pino-http`). Route handlers use `req.log`. esbuild bundles pino with `esbuild-plugin-pino`.
- **Frontend UI:** shadcn/ui (new-york style, neutral base color). Components in `src/components/ui/`. Tailwind CSS 4 via `@tailwindcss/vite`. Routing via wouter (not react-router).
- **State:** TanStack React Query for server state. Query client is cleared on Clerk user change.
- **Styling aliases:** `@` → `src/`, `@assets` → `attached_assets/`.
- **Error handling:** Best-effort features (speaker ID, memory extraction) are wrapped in try/catch and never fail the main reply. Only validate at system boundaries (user input via Zod, external API calls).

## Deploy targets

- **Frontend:** Vercel (`artifacts/ai-therapist/vercel.json`) — builds from repo root, outputs to `artifacts/ai-therapist/dist/public`
- **API server:** Railway (`artifacts/api-server/railway.toml`) — Nixpacks builder, healthcheck at `/api/healthz`

## Environment variables

Required secrets: `DATABASE_URL`, `GEMINI_API_KEY`, `DEEPGRAM_API_KEY`, `XAI_API_KEY`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `SESSION_SECRET`, `PORT`

LLM provider keys (at least one must be set): `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `KILOCODE_API_KEY`, `QWENCLOUD_API_KEY`

Optional: `ALLOWED_ORIGINS` (comma-separated CORS allowlist for production), `API_DEV_TARGET` (dev proxy target, defaults to `http://localhost:8080`), `BASE_PATH` (Vite base path)

## Gotchas

- **`@deepgram/sdk` v5 is fern-generated** — structurally different from v3. Check installed `.d.ts` files, not docs or prior knowledge.
- **`@google/genai` must NOT be in esbuild's `external` list** — it's a pure-JS fetch SDK that bundles correctly. The `external` globs in `build.mjs` use `@google-cloud/*` (not `@google/*`) to avoid incorrectly externalizing `@google/genai`, which would cause runtime `ERR_MODULE_NOT_FOUND`.
- **Kilo Code host must be `kilo.ai`** — `kilocode.ai` 308-redirects and silently eats POST bodies.
- **Replit-managed Clerk does NOT support** MFA, session inactivity timeout, SMS sign-in, or organizations.
- **`minimumReleaseAge: 1440` in `pnpm-workspace.yaml`** — supply-chain defense requiring packages to be published for at least 1 day before install. Do not disable. Use `minimumReleaseAgeExclude` for urgent trusted-package exceptions only.
- **`autoInstallPeers: false`** in workspace config — peer deps must be explicitly declared.
- **esbuild platform binary overrides** — only `linux-x64` binaries are kept (deploy targets are Linux); all other platform binaries are excluded via `overrides` to reduce install size.
- **The `replit.md` file documents this as "AI-Therapist"** — the repo is now named "AI-Counselor" but the internal doc retains the original name.
