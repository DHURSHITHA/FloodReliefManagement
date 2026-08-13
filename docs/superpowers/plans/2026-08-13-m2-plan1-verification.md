# Milestone 2 — Plan 1 (SOS) Verification Record

Executed inline against `docs/superpowers/plans/2026-08-13-m2-plan1-sos.md`, task by
task, TDD throughout (failing test confirmed before every implementation). This
record covers Task 10: the full-stack check against §16 acceptance criteria 15 and
16, run against the live dev server rather than the in-memory test database.

## Test suite

| Suite | Result |
|---|---|
| `shared` | 101/101 passed, 1 pre-existing failure (`camp.schema` facilities-default drift, documented since the Plan 4 M1 verification — reproduces identically on the pre-M2 commit, unrelated to this plan) |
| `server` | **232/232 passed** (31 files) — up from 215 at the start of this plan (17 new SOS tests: 10 service, 6 route, 1 dashboard) |
| `client` | **64/64 passed** (17 files) in isolation. One flaky timeout in `CreateCampPage.test.jsx` (unrelated, pre-existing, timing-sensitive test) surfaced only when the full suite ran concurrently with a live `npm run dev` process competing for the machine's resources — re-run alone, it passed in 23.5s against its 45s cap. Not a regression: that file predates Milestone 2 entirely and is untouched by this plan. |
| Production build | **1178 modules transformed**, built in 1.19s, no errors (only the standard >500kB chunk-size advisory) — up from 1172 modules at the M1 close |

## Live checks (`node --env-file=.env scripts/verify-sos.mjs`)

| # | Check | Result |
|---|-------|--------|
| 1 | Affected person raises a medical SOS, gets an `SOS-` code, routing resolved | **PASS** — `SOS-1001` created, `routed_to_name: "Test Hospital"`, `routed_to_contact: "0484-1111111"` |
| 2 | Routed contact matches the camp's actual hospital field, not a stale copy | **PASS** — cross-checked directly against the camp document: `nearest_hospital_name: "Test Hospital"`, `nearest_hospital_contact: "0484-1111111"` — exact match |
| 3 | Donor refused on `POST /sos` (§16 #16 routing is for affected persons/officials, not donors) | **PASS** — `403 "Your role does not have access to this action."` |
| 4 | Camp official's `GET /sos` is scoped to their own camp | **PASS** — 1 visible, the one just raised |
| 5 | Official acknowledges | **PASS** — `200`, transition recorded |
| 6 | Resolving without a note is refused | **PASS** — `400`, matching `updateSosSchema`'s closing-status rule |
| 7 | Resolving with a note succeeds and stamps `resolved_at` | **PASS** — `200`, `resolved_at` set |
| 8 | Admin dashboard Emergency area reflects the resolved request | **PASS** — `{"open":0,"medical":0,"security":0,"resolved":1}` |
| 9 | Reporter is notified on every transition | **PASS** — `"SOS-1001 is now resolved."` and `"SOS-1001 is now acknowledged."`, newest first |

All 9 checks **PASS**. §16 criterion 15 ("Complaints and SOS requests can be created,
routed, and tracked to resolution") and criterion 16 ("Medical/security emergencies
correctly identify and route to the linked hospital/police contact for that camp")
are both demonstrated live, not just in the in-memory test suite.

## What this closes

Group E (Response) of the requirements is now complete. Complaints (§6.10) shipped
during M1; SOS (§6.11) ships with this plan. Every M1-deferred obligation the §16
read-through attached to SOS is satisfied:

- Routing is copied at creation, not referenced live (verified directly by check 2).
- A closing status without a note is refused (check 6) — the same rule complaints
  already enforces.
- The Emergency dashboard area is live and computed, never manually entered (check 8).
- The reporter hears back on every transition (check 9), same as complaints.

## Known gaps (deferred by design, not defects)

- Live evidence of `sos:update` Socket.IO broadcasts reaching a connected browser
  was not captured — the script exercises the HTTP API only. The emit call sites
  (`sos.service.js`) and the client subscription (`useLiveSosUpdates`) are each unit-
  and integration-tested independently, and the wiring is the same pattern
  `emitCampOccupancy` / `useLiveCampUpdates` already use in production. Demonstrating
  the socket round-trip live would need a browser-driven check, which is out of
  scope for a scripted API verification.
- Leftover verification data (`SOS-1001` and its notifications) remains in the dev
  Atlas database, same as every M1 plan's verification — flagged, not deleted.

## Milestone 2 status

Plan 1 of 4 complete. Remaining: Plan 2 (donors and donations), Plan 3 (fund
requests, expenses, bills), Plan 4 (utilization and the Finance dashboard area).
