# AI-Counselor

pnpm monorepo. See `replit.md` for full documentation.

## Commands

- `pnpm run typecheck` — typecheck all packages (run `tsc --build` project refs)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run dev` — run API server (Railway deploy target)
- `pnpm --filter @workspace/ai-therapist run dev` — run web frontend (Vercel deploy target)
- `pnpm --filter @workspace/db run push` — push DB schema to dev database
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client/hooks from OpenAPI spec

## Architecture

**Third-party SDKs are wrapped in `lib/` workspace packages:**
- `lib/gemini/` — `@google/genai` wrapper (requires GEMINI_API_KEY)
- `lib/deepgram/` — `@deepgram/sdk` v5 fern-generated wrapper (requires DEEPGRAM_API_KEY)
- `lib/db/` — Drizzle ORM + PostgreSQL

**Do NOT add third-party SDKs as direct dependencies of `api-server`.** Always wrap in a `lib/<service>` package first.

**esbuild `external` globs in `artifacts/api-server/build.mjs` must NOT match workspace-wrapped SDKs:** `@google/*` would incorrectly externalize `@google/genai` causing runtime ERR_MODULE_NOT_FOUND.

## Gotchas

- `@deepgram/sdk` v5 is fern-generated — structurally different from v3. Check installed `.d.ts` files, not docs.
- `@google/genai` must NOT be in esbuild's external list; it's a pure-JS fetch SDK that bundles correctly.
- Required secrets: `DATABASE_URL`, `GEMINI_API_KEY`, `DEEPGRAM_API_KEY`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `SESSION_SECRET`
- Replit-managed Clerk does NOT support MFA, session inactivity timeout, SMS sign-in, or organizations.