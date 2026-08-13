# Plan 4 Verification — Relief Ops (Milestone 1, slices 8–9)

**Date:** 2026-08-12
**Against:** live MongoDB Atlas cluster, real running server (`npm run dev`, server under `node --watch`), real Vite client.

## Automated suite

- Server: `npm test --workspace server` → **28 test files, 185 tests, all passing** (197.8s).
- Client: `npm test --workspace client` → **11 test files, 32 tests, all passing.**
- Concurrency invariants proven with real races, not code review: the distribution transaction's insert-first duplicate test and the inventory compare-and-swap deduction test both run genuinely concurrent callers against a real `MongoMemoryReplSet`.

### Test-infrastructure defect found and fixed

`syncIndexes()` ran in every `beforeEach` — roughly 18 models × 185 tests. It dominated the run time and churned index state between tests, producing intermittent `E11000` failures on unrelated fixtures (`admin@example.org`). Indexes survive `clearDatabase()`, which only empties documents, so the sync is now memoized per process (`server/src/test/helpers.js`). Suite went **285s → 198s** and the intermittent failures disappeared (commit `759dde6`).

### Three deliberate improvements over the plan draft

1. **Low-stock notifications name the item.** The plan interpolated a raw `ObjectId` into the message. `announceLowStock` now loads the `ResourceItem` and renders `"Rice (kg) is low: 20 left, reorder threshold 90."`
2. **`listActiveVolunteers` replaced a search-by-prefix workaround.** The plan proposed listing volunteers by querying beneficiary codes by prefix — a weakness its own self-review flagged. Added a real `GET /api/volunteers` endpoint instead.
3. **The socket broadcast moved outside the transaction.** Emitting `inventory:changed` inside `withTransaction` meant a rolled-back retry attempt would tell every connected client stock had been spent when it hadn't. The emit and the low-stock announcement now run after the transaction commits, from its returned result.

## Manual checks against slices 8–9's "done when" (spec §10)

All performed via `curl` against the real server with the real `.env` Atlas connection, same pattern as Plans 1–3's final tasks.

| # | Check | Result |
|---|-------|--------|
| 1 | Admin creates a resource item and stocks a camp | **PASS** — "Rice" (kg) created as `6a7c8f504c475066b1b9f8e1`; camp `6a7c6394d9d42773539a5741` stocked with 100 units, `reorder_threshold` 90; visible via `GET /api/inventory?camp_id=`. |
| 2 | Admin configures a fixed-mode rice rule | **PASS** — fixed/daily rule, qty 5, created with `camp_id: null` (global default); returned by `GET /api/distribution-rules?item_id=`. |
| 3 | Distribution drops stock by exactly the ration amount | **PASS** — distributed to `BEN-1001` → record `quantity: 5`, `period_key: "2026-08-12"`; inventory `remaining_qty` 100 → 95 and `distributed_qty` 0 → 5. Exactly the ration, no drift. |
| 4 | Same beneficiary + item, same day → blocked | **PASS** — `409 ALREADY_DISTRIBUTED`, and `remaining_qty` stayed at 95. Insert-first ordering (spec §5.4) means the duplicate is rejected by the unique index before stock is ever touched. |
| 5 | Unverified beneficiary blocked; override permitted and audited | **PASS** — `BEN-1002` (zero checked-in members) → `409 NOT_VERIFIED`; the same call with `override_reason` succeeded and the reason persisted on the record and in `audit_logs`. |
| 6 | Dropping stock below `reorder_threshold` notifies the admin | **PASS** — `PATCH /api/inventory/:id` to 20 → `is_low_stock: true`, 2 notifications in `GET /api/notifications`, newest reading *"Rice (kg) is low: 20 left, reorder threshold 90."* Two entries because the **override distribution in check 5** took stock 95 → 90, landing exactly on the threshold (the guard is `<=`), and the manual PATCH then crossed it again — proving both the distribution path and the manual-adjust path announce. Check 3's distribution left 95, above the threshold, and correctly announced nothing. |
| 7 | Volunteer duty assigned then completed | **PASS** — assign → `volunteer_status: "active"`; complete with 4 hours → `"completed"` with hours logged. `GET /api/volunteers` listed the 2 remaining awaiting volunteers with their beneficiary codes. |
| 8 | `/admin` shows live figures; `/official` links to all its screens | **PASS** — `GET /api/dashboard/summary` returned 2 camps / 5 of 410 beds, 3 households registered + 2 people checked in + 1 high priority (kept as separate figures per spec §6.16), volunteers 1 accepted + 1 completed, inventory 1 low-stock item, flood monitoring 1 affected area + 1 active alert. All matched direct API totals. `/official` now has a home page linking to check-in, distribute, history, and volunteer duties. |
| 9 | Donor role refused on relief-ops routes | **PASS** — `POST /api/distributions` → 403, `POST /api/resources` → 403, `GET /api/dashboard/summary` → 403, `GET /api/volunteers` → 403. |

## Known gaps (deferred by design, not defects)

- **A full spec §16 Acceptance Criteria read-through across all four plans is still outstanding.** Each plan verified its own slices against §10's "done when" lines; nobody has yet walked §16 end to end against the assembled system. **This is the next piece of work before Milestone 1 can be declared fully done.**
- `shared/src/schemas/camp.schema.test.js`'s "defaults every facility flag" case fails, and fails identically on the pre-Plan-3 commit (confirmed via `git stash`) — a zod version drift predating this plan. Left alone deliberately: out of scope here, worth its own fix.
- Leftover verification data (the Rice item, the stocked camp inventory, the global rice rule, distribution records for `BEN-1001`/`BEN-1002`, and the low-stock notifications) remains in the dev Atlas database, same as Plans 1–3's verifications — flagged, not deleted.

## Conclusion

Plan 4 (Milestone 1, slices 8–9: Relief Ops — resources, inventory, the hybrid distribution rule engine, the atomic distribution transaction, notifications, volunteer duties, and the admin dashboard) is **complete and verified** against both the automated suite and the spec's own "done when" criteria, run against the real system.

All four Milestone 1 plans are now implemented. The remaining gate is the §16 read-through above.
