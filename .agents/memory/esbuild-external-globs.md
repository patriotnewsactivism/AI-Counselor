---
name: esbuild external globs vs workspace lib packages
description: A too-broad external glob in the api-server esbuild config can silently break workspace libs that wrap the globbed package.
---

`artifacts/api-server/build.mjs` externalizes a long list of native/unbundleable packages via glob patterns (e.g. `@google-cloud/*`). Some of these globs are broader than intended — e.g. `@google/*` also matches `@google/genai`, a pure-JS fetch-based SDK with no reason to be externalized.

**Why:** Externalizing a package only works at runtime if that package is resolvable from `artifacts/api-server`'s own `node_modules` — which requires it to be a **direct** dependency of `api-server`'s `package.json` (pnpm's isolated node_modules won't hoist it otherwise). When the actual SDK dependency lives only in a `lib/<service>` workspace package (the intended architecture for hand-wrapped third-party SDKs), the external glob causes `ERR_MODULE_NOT_FOUND` in the production bundle even though everything type-checks and dev-builds fine.

**How to apply:** Before adding or trusting a broad glob like `@scope/*` in the `external` array, confirm every package it could match is either (a) actually unbundleable (native bindings, dynamic file loading) or (b) a direct dependency of `api-server`. When wrapping a new third-party SDK in its own `lib/` package, prefer letting esbuild bundle it normally (remove/narrow any glob that would externalize it) unless it specifically needs native modules.
