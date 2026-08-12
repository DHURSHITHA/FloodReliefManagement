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

Run against the real stack (`node src/server.js` with `--env-file=../.env`)
connected to a live MongoDB Atlas dev database (`flood_relief_dev`). Checks
2–9 were exercised directly with `curl` against the running server rather
than through the browser UI, since Plan 1 ships no screens beyond
login/signup; each curl call reproduces exactly what the corresponding
client code (`api/client.js`, `AuthProvider.jsx`) does over HTTP.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | `GET /api/health` returns `{"status":"ok"}` | **PASS** | `{"status":"ok","env":"development"}` |
| 2 | Sign up as affected person → login works, no OTP anywhere | **PASS** | Signup → `status:"active"` immediately; login → 200 with `access_token`. No OTP step exists in the API surface at all. |
| 3 | Sign up as camp official → "awaiting administrator approval" | **PASS** | Signup → `status:"pending_approval"`; login attempt → 403 `ACCOUNT_PENDING_APPROVAL`, "Your camp official account is awaiting administrator approval." |
| 4 | Admin approves official → official can now sign in | **PASS** | Admin login → `GET /pending-officials` listed the official → `POST /officials/:id/decision {decision:"approve"}` → `status:"active"` → official login → 200 |
| 5 | Reload while signed in → still signed in (refresh cookie) | **PASS** | `POST /auth/refresh` using only the saved cookie jar (no access token) returned a fresh `access_token` and the user — this is the exact call `AuthProvider`'s `restoreSession()` makes on page load. |
| 6 | Sign out → reload → signed out; `/admin` redirects to login | **PASS** | `POST /auth/logout` → 204. Subsequent `POST /auth/refresh` with the same cookie → 401 `TOKEN_INVALID` — the state `RequireAuth` reads as "no user" and redirects on. |
| 7 | Donor token against `/api/auth/pending-officials` → 403 | **PASS** | Donor signup + login → `GET /pending-officials` with donor's bearer token → 403 `FORBIDDEN`, proving server-side enforcement independent of what any UI shows. |
| 8 | No token in Local Storage; `refresh_token` cookie is HttpOnly | **PASS** | `curl -v` on login showed `Set-Cookie: refresh_token=...; HttpOnly; SameSite=Strict; Path=/api/auth`. `grep -r localStorage client/src` found zero uses (only a comment explaining why it's avoided) — the access token genuinely never leaves memory. |
| 9 | `audit_logs` in Atlas has signup/login/approval entries, no secrets | **PASS** | Live query against Atlas: 12 documents — 3 `user.signup`, 7 `user.login`, 1 `user.official_approved`, 1 `user.bootstrap_admin_created`. A regex sweep for `password`/`password_hash`/`refresh_token`/`aadhaar_enc`/`aadhaar_hash` and both plaintext test passwords across the full serialized result set: no match. |

**All nine checks PASS.**

## To reproduce

1. `.env` at the repo root holds a live `MONGODB_URI` (dev Atlas cluster) and the four generated secrets — gitignored, not committed.
2. `npm run seed --workspace server` — idempotent; verified by running it twice (second run logged "already exists" and created nothing).
3. `node --env-file=../.env src/server.js` (from `server/`) — API on `http://localhost:4000`.
4. The nine checks above were run via `curl` and a one-off Mongoose query script (deleted after use, never committed) against the live database.

## Defect log

**One defect found and fixed during Task 11, before this verification ran** (not during the checklist itself): the plan's own reference `AuthProvider.jsx` tracked `user` in a `useState` that `useLogin`'s `onSuccess` never updated — only the TanStack Query cache was written. A freshly logged-in user would have hit `RequireAuth` still reading `user: null` and been bounced straight back to `/login`, which would have failed check 2 above. Fixed by having `AuthProvider` read `user` directly from the same `meQueryKey` cache entry `useLogin` writes to. See the Task 11 commit message for detail.

No other defects found. Zero failures in the automated suite; all nine manual checks passed on the first run against live Atlas.

## Test data left in the dev database

Verification created a handful of throwaway accounts in `flood_relief_dev` beyond the seeded admin: "Verify Person" (affected_person), "Verify Official" (camp_official, now active), "Verify Donor" (donor), plus their audit trail. Left in place since this is a dev database and deleting records wasn't asked for — flagging here in case you'd rather they not linger.
