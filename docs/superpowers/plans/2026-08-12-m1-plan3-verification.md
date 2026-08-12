# Plan 3 Verification — Intake (Milestone 1, slices 5–7)

**Date:** 2026-08-12
**Against:** live MongoDB Atlas cluster, real running server (`node server.js` under `--watch`, already live from earlier in the session and auto-restarted on every Plan 3 file change).

## Automated suite

- Server: `npm test --workspace server` → **21 test files, 146 tests, all passing.**
- Client: `npm test --workspace client` → **8 test files, 23 tests, all passing.**
- Concurrency invariants proven with real races, not code review: `intake.service.test.js`'s two-concurrent-registrations-for-the-last-bed test, and `camps.service.test.js`'s two-concurrent-volunteer-slot-requests test.

Two real defects were found and fixed while building this plan (see commits `18d46c0`, `c51198f`):
1. A `findOneAndUpdate` pipeline update computing `volunteers_accepted = min(capacity, accepted + N)` in one atomic step looked race-free but wasn't: two concurrent callers each computing their own "granted" return value from a separate before/after read double-counted the grant, even though the stored count itself never overshot. Replaced with the classic compare-and-swap-with-retry pattern spec §5.3 actually describes.
2. `registrationMemberInputSchema`'s `relation_to_applicant`/`mobile`/`address` fields ran their own `min()`/`regex()` validation on an empty string before `superRefine`'s friendlier, position-aware message ever got a chance to run — an untouched client field arrives as `''`, not `undefined`, and `z.optional()` only skips the latter. Fixed by preprocessing `''` to `undefined` ahead of each field's inner schema.

## Manual checks against slices 5–7's "done when" (spec §10)

All performed via `curl` against the real server with the real `.env` Atlas connection, same pattern as Plans 1 and 2's final tasks.

| # | Check | Result |
|---|-------|--------|
| 1 | A family registers (3 members, one applicant + two children) → receives a `BEN-` code | **PASS** — `BEN-1001` issued for a 3-person family. |
| 2 | `priority_tags`/`priority_level` computed correctly, not settable | **PASS** — the 10-year-old member got `priority_tags: ["child"]`, `priority_level: "high"`; the two adults got `[]`/`"normal"`. Computed server-side in the model hook, no field for it in the request payload. |
| 3 | A duplicate Aadhaar is blocked, naming the exact colliding member | **PASS** — reusing the first family's applicant's Aadhaar returned `409 DUPLICATE_AADHAAR` with `"Someone Else, XXXX XXXX 0605 already has an active registration."` and `details[0].path: "members.0.aadhaar"`. |
| 4 | `Idempotency-Key` prevents a double-submit from creating a second registration | **PASS** — two identical `POST /registrations` calls with the same key both returned `BEN-1002` and the same member id; only one document exists. |
| 5 | Volunteer FCFS: 3 opt in against 2 remaining slots → exactly 2 accepted, in submission order | **PASS** — in the 3-person family above (camp `volunteer_capacity: 2`), the applicant and first child (submitted first and second) got `volunteer_status: "accepted"`; the second child (submitted third) got `"not_accepted_slots_full"`. |
| 6 | An official finds a family and partially checks them in | **PASS** — checked in 2 of the 3-member family; `beneficiary.status` became `"partially_checked_in"`. |
| 7 | `POST /registrations` is refused for non-`affected_person` roles | **PASS** — both admin and donor accounts got `403` on the write route (admin's own accounts cannot self-register; that's `affected_person`-only by design). |
| 8 | `audit_logs` has `registration.create` and `member.checkin` entries with no Aadhaar leakage | **PASS** — 4 entries found; scanned for `aadhaar_hash`/`aadhaar_enc`/`"aadhaar"`/`password`/`refresh_token` substrings across the full JSON of each record — none present. |

## Known gaps (deferred by design, not defects)

- A public "status lookup by code" screen (spec §7.1 lists it separately) isn't built — `GET /registrations/me` already covers the affected person's own status; a dedicated lookup screen can be added later without touching this plan's work.
- `decryptAadhaar` round-trips correctly (Task 1's tests) but nothing in M1 calls it outside tests — no feature needs lawful retrieval of the plaintext yet.
- Resources, inventory, and distribution (spec slices 8–9) are Plan 4.
- Leftover test data from this verification (a "Plan3 Verification Camp", `BEN-1001`/`BEN-1002`, and an `Idem Test` registration member) remains in the dev Atlas database, same as Plans 1 and 2's verifications — flagged, not deleted.

## Conclusion

Plan 3 (Milestone 1, slices 5–7: Intake — registration, Aadhaar crypto, dedup, priority, volunteer FCFS, check-in) is **complete and verified** against both the automated suite and the spec's own "done when" criteria, run against the real system.
