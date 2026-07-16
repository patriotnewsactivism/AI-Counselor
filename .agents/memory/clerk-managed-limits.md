---
name: Replit-managed Clerk limitations
description: Features NOT available in Replit-managed Clerk (as of July 2026).
---

Confirmed via `searchReplitDocs` July 2026:
- **MFA (multi-factor authentication)** — not supported for end users on Replit-managed Clerk instances.
- **Session inactivity timeout** — not a configurable option; session lifetime is managed automatically by Clerk but cannot be set to expire after N idle minutes.
- **SMS/phone sign-in** — not supported.
- **Organization tenants** — not supported.

**Why:** Replit manages a shared Clerk tenant on behalf of users; only a subset of Clerk's full feature set is exposed. The Auth pane handles user management and consent screen configuration but not advanced security policies.

**How to apply:** Do not promise or attempt to enable MFA or inactivity-based sign-out via code — they are platform-level constraints, not missing config. Tell the user these limitations exist and suggest Replit may add them in future. The alternative security posture is: Clerk's secure httpOnly session cookies + per-user DB query scoping (already enforced on every route via requireAuth + userId filter).
