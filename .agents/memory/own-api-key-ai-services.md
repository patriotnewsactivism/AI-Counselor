---
name: Own-API-key AI/voice service architecture
description: Pattern for wiring a user's own third-party API key (LLM, STT/TTS, etc.) when the Replit AI proxy isn't usable.
---

When Replit's AI Integrations proxy is unavailable for a service (e.g. blocked by an account-tier requirement), and the user has their own API key for a provider (Gemini, Deepgram, OpenAI, etc.) set up as a Replit secret, wrap the official SDK in its own small workspace package under `lib/<service>/` rather than calling the SDK directly from `artifacts/api-server` routes.

**Why:** Keeps the third-party SDK dependency and its API-shape quirks (see e.g. `deepgram-sdk-v5.md`) isolated to one place, makes it easy to typecheck independently via `tsc --build` project references, and keeps route handlers thin and swappable if the backing provider changes later.

**How to apply:**
- Create `lib/<service>/package.json` (`@workspace/<service>`), `tsconfig.json`, `src/client.ts` (constructs the client from the secret env var, throws clearly if missing), and `src/index.ts` (the actual operations used by routes).
- Add project references in the root `tsconfig.json` and the consuming artifact's `tsconfig.json`.
- Add `@workspace/<service>` as a workspace dependency of the consuming artifact — do NOT also add the raw third-party SDK as a direct dependency of the artifact; that duplicates the dependency and invites accidental direct imports that bypass the wrapper.
