---
name: Deepgram SDK v5
description: How to work with the fern-generated @deepgram/sdk v5.x API, which differs completely from v3/older docs.
---

`@deepgram/sdk` v5 (fern-generated) has a completely different shape from v3 and from most docs/blog posts/prior model knowledge. Do not guess method names from memory — read the installed `.d.ts` files under `node_modules/.pnpm/@deepgram+sdk@<version>/node_modules/@deepgram/sdk/dist/cjs/` directly.

**Why:** Wasted a full debugging cycle assuming the v3-style API (`deepgram.listen.prerecorded.transcribeFile`, `deepgram.speak.request(...).getStream()`) still applied. It doesn't — v5's surface is entirely different and none of it is discoverable from general SDK knowledge.

**How to apply**, confirmed against v5.5.0:
- Client construction: `new DeepgramClient({ apiKey })` (not `createClient(key)` — that v3 helper is gone). `DeepgramClient` is exported from the package root.
- Transcription: `deepgram.listen.v1.media.transcribeFile({ data: buffer, contentType: mimeType }, { model: "nova-3", smart_format: true, punctuate: true })`. The promise resolves directly to the parsed response (it's an `HttpResponsePromise<T>`, a `Promise<T>` subclass — just `await` it, no `.result`/`.data` unwrap needed). Transcript path: `response.results.channels[0].alternatives[0].transcript`. Check `"results" in response` first since async/callback mode returns a different accepted-response shape.
- Synthesis: `deepgram.speak.v1.audio.generate({ text, model: "aura-2-callista-en", encoding: "mp3" })` resolves to a `BinaryResponse`-like object; get raw bytes via `await binary.arrayBuffer()` (also has `.blob()`, `.stream()`, optional `.bytes()`).
- Uploadable audio input accepts a plain `{ data, contentType }` object (no need for `fs`-specific helpers) for in-memory buffers.
