# Aura deployment reconciliation

- [x] Add explicit Express static frontend mount and SPA fallback to consolidated API service.
- [x] Run typecheck/build and local smoke test for `/` and `/api/healthz`.
- [ ] Commit, push, and deploy the static-serving fix and playback/profile improvements.
- [ ] Verify Railway deployment status, root HTML, health endpoint, and frontend/provider markers.
- [ ] Inspect/confirm production Postgres schema and apply the repository schema if needed.
- [ ] Recheck custom-domain certificate/DNS routing and report remaining user action.

## Current feature work

- Manual `Interrupt Aura` stops current playback and reopens listening.
- `Pause & speak` pauses the audio element in place; `Resume Aura` continues from the same position.
- Recorder start/stop and duplicate-turn guards remain enabled.
- Local name-based voice enrollment works without Gemini; re-enrollment updates the existing named profile.
