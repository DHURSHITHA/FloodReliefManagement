# Plan 1 (Foundation & Authentication) — Verification Record

**Date:** 2026-08-12
**Plan:** `docs/superpowers/plans/2026-08-12-m1-plan1-foundation-and-auth.md`
**Spec:** `docs/superpowers/specs/2026-08-12-flood-relief-portal-m1-design.md`

## Automated suite

Run: `npm test` (root, all three workspaces)

| Workspace | Files | Tests | Result |
|---|---|---|---|
| `shared` | 3 | 23 | PASS |
| `server` | 8 | 60 | PASS |
| `client` | 1 | 6 | PASS |
| **Total** | **12** | **89** | **PASS, zero failures** |

The server suite runs against `MongoMemoryReplSet` (a real single-node replica
set, not a standalone `mongod`), so the transaction-rollback proof in
`transaction.test.js` and every other test ran against genuine MongoDB
transaction semantics, not a mock.

## Manual checklist against requirements §16

These steps require the real stack (`npm run dev`) connected to a live
MongoDB Atlas database, which needs a `MONGODB_URI` this session does not
have. **Not yet run** — recorded here as pending, not skipped silently:

| # | Check | Result |
|---|---|---|
| 1 | `GET /api/health` returns `{"status":"ok"}` | PENDING |
| 2 | Sign up as affected person → login works, no OTP anywhere | PENDING |
| 3 | Sign up as camp official → "awaiting administrator approval" | PENDING |
| 4 | Admin approves official → official can now sign in | PENDING |
| 5 | Reload while signed in → still signed in (refresh cookie) | PENDING |
| 6 | Sign out → reload → signed out; `/admin` redirects to login | PENDING |
| 7 | Donor token against `/api/auth/pending-officials` → 403 | PENDING |
| 8 | DevTools: no token in Local Storage; `refresh_token` cookie is HttpOnly | PENDING |
| 9 | `audit_logs` in Atlas has signup/login/approval entries, no secrets | PENDING |

Checks 2, 3, 6, 7 are exercised end-to-end by the automated suite already
(`auth.signup.test.js`, `auth.login.test.js`, `auth.approval.test.js`,
`auth.middleware.test.js`) against the in-memory replica set — the same
code path, a different MongoDB instance. Checks 1, 4, 5, 8, 9 need the real
browser + real Atlas to observe directly (cookie flags in DevTools, the
actual seeded document in Atlas, hot-reload session restore).

## To complete this record

1. Copy `.env.example` to `.env` at the repo root.
2. Set `MONGODB_URI` to a dev Atlas connection string.
3. Generate the four secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (run four times).
4. Set `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`.
5. `npm run seed --workspace server` (twice — second run must say "already exists").
6. `npm run dev` and walk the nine checks above.
7. Update this file's PENDING rows to PASS/FAIL with evidence and re-commit.

## Defect log

None found in the automated suite. Nothing to report from the manual
checklist yet, since it has not run.
