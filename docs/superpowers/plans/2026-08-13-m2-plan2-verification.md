# Milestone 2 — Plan 2 (Donors and Donations) Verification Record

Executed inline against
`docs/superpowers/plans/2026-08-13-m2-plan2-donors-and-donations.md`, task by task,
TDD throughout (failing test confirmed before every implementation). This record
covers Task 13: the full-stack check against §16 acceptance criterion 17, run
against the live dev server rather than the in-memory test database.

## Test suite

| Suite | Result |
|---|---|
| `shared` | 121/122 passed, 1 pre-existing failure (`camp.schema` facilities-default drift, documented since the Plan 4 M1 verification and reproduced identically ever since — unrelated to this plan) |
| `server` | **270/270 passed** (33 files) — up from 260 at the start of Task 6 (10 new: confirm/reject Task 6, listing Task 7 adds 6, leakage Task 8 adds 4 — donations.test.js totals 32: 5 profile, 8 creation, 9 confirm/reject, 6 listing, 4 cross-role leakage) |
| `client` | **79/79 passed** (19 files) — includes all 12 donations tests in `Donations.test.jsx` (4 DonorProfilePage, 4 DonationEntryPage, 4 DonationReviewPage) plus the 3 hook tests in `api/donations.test.jsx` |
| Production build | not re-verified separately this task; both workspace suites build and run clean via Vitest/Vite tooling |

## Live checks (`node --env-file=.env scripts/verify-donations.mjs`)

| # | Check | Result |
|---|-------|--------|
| 1 | Donor profile saves (§6.12) | **PASS** — `200` |
| 2 | Resource item created for the material donation | **PASS** — `201` |
| 3 | Material donation created `pending`, gets a `DON-` code | **PASS** — `201 DON-1001` |
| 4 | Admin confirms the material donation | **PASS** — `200`, `status: "confirmed"` |
| 5 | Confirming posts stock into the target camp only, via `receiveStock` (§16 #17, §4.2 of the M2 design) | **PASS** — camp inventory for that item: `0 → 100`, exactly the donated quantity |
| 6 | Financial donation created, gets a `DON-` code | **PASS** — `201 DON-1002` |
| 7 | Rejecting with no reason is refused | **PASS** — `400` |
| 8 | Rejecting with a reason succeeds | **PASS** — `200`, `status: "rejected"` |
| 9 | Donor's own confirmed-financial total is computed from the list response, never a stored field (§16 #20) | **PASS** — `₹0`, correct for this run: the only confirmed donation was the material one, the financial donation was rejected, and the value came from summing `GET /donations/mine`, not any stored total |
| 10 | An affected person is refused on `POST /donations` | **PASS** — `403` |
| 11 | A donor is refused on `GET /donations` (admin-only) | **PASS** — `403` |

All 11 checks **PASS**. §16 criterion 17 ("Donors can record fund and material
donations and receive a unique Donation ID") is demonstrated live: a `DON-` code is
issued on creation, and a material donation's confirmation posts real stock into the
named camp's inventory — not just in the in-memory test suite.

## What this closes

Group F (Money) of the requirements begins with this plan: donor profiles (§6.12)
and donation recording/confirmation/listing (§6.13) now ship end-to-end. Every M1-
deferred obligation the §16 read-through attached to donations is satisfied so far:

- Material donations post real stock only on admin confirmation, through the same
  `receiveStock` primitive `resources.service.js` already exposes — not a parallel
  code path (checks 4-5).
- Donor financial totals are always derived from the list, never stored on the donor
  or donation record (check 9) — the same principle §16 #20 requires for camp-level
  totals, applied here at the donor level.
- Confirmation and rejection are transactional and idempotent: a second decision on
  an already-decided donation is refused with `409` (unit-tested; not re-exercised
  live to avoid corrupting the verification run's own donations).
- Role boundaries hold under adversarial testing, not just the happy path (checks
  10-11, plus the dedicated cross-role leakage task).

## Deviations from the plan, folded back in

Two real bugs were caught and fixed during execution, both folded back into the plan
document so it stays accurate for future re-execution:

- **Task 3** (`receiveStock`): the plan's original upsert-only design lost a
  concurrency race under 5-way parallel first-time receipt. Fixed with a
  `source: 'manual' | 'donation'` field and a partial unique index scoped to
  `source: 'donation'`, so `receiveStock`'s "one lot per camp/item" merge applies
  only to donation-sourced lots — manually-created batches still support more than
  one per camp/item, unchanged from M1. Task 6's "adds donated stock to an existing
  lot" test was corrected to seed the existing lot via a prior donation confirmation
  rather than a manual `POST /inventory` call, since the two are now deliberately
  separate documents.
- **Task 10/12** (client tests): the shared `vi.mock` block for `api` only stubbed
  `get`/`post`, not `patch`; Task 12's confirm/reject tests call
  `api.patch.mockResolvedValue` directly, which would have hit the real axios method
  instead of the mock. Added `patch: vi.fn()` to the mock block.

## Known gaps (deferred by design, not defects)

- Live evidence of donation-related Socket.IO inventory broadcasts (`emitInventoryChanged`
  on confirmation) reaching a connected browser was not captured — the script
  exercises the HTTP API only, same limitation as Plan 1's verification. The emit
  call site (`donations.service.js`'s `confirmDonation`) and the client's existing
  `useLiveInventory` wiring are each independently tested; a live browser check is
  out of scope for a scripted API verification.
- Leftover verification data (`DON-1001`, `DON-1002`, the `Verify Rice` item, and
  their notifications) remains in the dev Atlas database, same as every prior plan's
  verification — flagged, not deleted.
- Idempotency (refusing a second decision on an already-decided donation) is unit-
  tested but not re-exercised live in this script, to avoid a second confirm/reject
  attempt corrupting the run's own donations before the derived-total check runs.

## Milestone 2 status

Plan 2 of 4 complete. Remaining: Plan 3 (fund requests, expenses, bills), Plan 4
(utilization and the Finance dashboard area).
