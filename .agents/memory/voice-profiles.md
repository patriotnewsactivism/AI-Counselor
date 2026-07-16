---
name: Voice profile feature architecture
description: How multi-speaker persistent voice recognition is implemented in Aura (AI-Therapist).
---

Speaker recognition uses Gemini's multimodal audio input — NOT a dedicated biometric speaker-verification service. This is explicitly best-effort / heuristic accuracy, suitable for distinguishing a handful of household voices, not cryptographic identification.

**Why:** No biometric speaker-verification SDK is available in the Node/TS stack without a separate paid cloud service (Azure Speaker Recognition, etc.). Gemini 2.5's audio understanding is capable enough for personal-use voice differentiation with a small enrolled set.

**How to apply:**
- `lib/gemini/src/speaker.ts` — `identifyOrEnrollSpeaker({ profiles, newAudioBase64, newMimeType, transcript })` → `{ matchedProfileId, matchedName, introducedName }`. Wraps in try/catch; failures return all-null (never block the main reply).
- `lib/db/src/schema/voiceProfiles.ts` — `voiceProfilesTable`: id, userId (owner Clerk account), name, sampleAudio (base64), sampleMimeType, lastHeardAt, createdAt, updatedAt.
- `lib/db/src/schema/messages.ts` — `speakerName` nullable text column on messagesTable (set on user-role voice messages only).
- `artifacts/api-server/src/routes/conversations/voiceMessages.ts` — speaker ID runs between transcription and companionExchange; auto-enrolls if introducedName present; updates lastHeardAt on match. All wrapped in try/catch, non-blocking.
- `artifacts/api-server/src/routes/voiceProfiles.ts` — CRUD: GET/POST /voice-profiles, PATCH/DELETE /voice-profiles/:id, all behind requireAuth + userId scoping.
- `lib/gemini/src/persona.ts` — `buildSystemInstruction` accepts optional `speakerName`; uses it to address the identified speaker directly rather than the account owner's preferredName.
- `lib/gemini/src/index.ts` — `generateCompanionReply` accepts optional `speakerName`.
- Stats endpoint now includes `voiceProfileCount`.
- Frontend: Settings page has VoiceProfilesSection (list/rename/delete/enroll with MediaRecorder); companion chat shows subtle speaker name badge per message and toasts on auto-enrollment.

**Retention:** Profiles persist indefinitely until manually deleted from Settings. There is no automatic expiry — this matches the user's stated preference for long-term recognition ("days, weeks, I don't know how long").

**Privacy constraint:** Enrollment requires either explicit manual action (user opens Settings > Add voice) or the speaker actively introducing themselves in conversation ("I'm Zach"). There is no covert fingerprinting of uninteracting parties.
