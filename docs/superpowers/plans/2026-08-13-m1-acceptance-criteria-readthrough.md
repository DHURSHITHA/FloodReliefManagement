# Milestone 1 — §16 Acceptance Criteria read-through

The M1 design spec (§10) requires "a final pass [that] verifies Milestone 1 against every
applicable line of §16 Acceptance Criteria." This is that pass. It is the last gate before
Milestone 1 can be declared done.

Requirements §16 lists 25 criteria covering the whole product, not just M1. Each is
classified below as **M1** (must pass now), or as belonging to a deferred group — **E**
(response), **F** (money), **G** (insight) — in which case it is out of scope for this pass
and named as an obligation on the milestone that owns it.

## Result

**15 of 15 M1-applicable criteria PASS.** No M1 criterion is unmet or partially met.

Ten criteria belong to E/F/G. One of those (#22, the dashboard) is *partially* satisfied
today and finishes incrementally as E and F land, exactly as §7.1 of the M1 spec intended.

## The read-through

| # | Criterion (abbreviated) | Owner | Status |
|---|---|---|---|
| 1 | Admin creates a camp with full config incl. volunteer capacity and duration, assigns a Camp Official | M1 | **PASS** — `camps.service.js`; official assignment now requires ≥1 camp (`officialDecisionSchema`) |
| 2 | Open camps on the landing page with live, accurate capacity for beneficiaries **and** volunteers | M1 | **PASS** — dual capacity tracked separately, decremented under atomic compare-and-swap |
| 3 | Affected Person signs up, logs in, registers — no OTP step | M1 | **PASS** — OTP is permanently out of scope per requirements §3.2 |
| 4 | Aadhaar required and validated for applicant and every added member | M1 | **PASS** — Verhoeff checksum, applied per member |
| 5 | Unique Beneficiary ID generated after registration | M1 | **PASS** — `BEN-` sequence |
| 6 | Duplicate detection and priority classification run per individual on submission | M1 | **PASS** — insert-first duplicate detection against the unique Aadhaar-hash index (spec §5.4); `derivePriority` per member |
| 7 | A full camp triggers a nearest-available-camp recommendation | M1 | **PASS** — `GET /api/camps/nearest` (`camps.routes.js:14`, `camps.service.js:151`); the full-camp rejection points at it (`intake.service.js:90`) |
| 8 | Volunteer capacity enforced separately from beneficiary capacity, per individual, FCFS | M1 | **PASS** — separate counter, separate guard |
| 9 | Camp Official can find and physically verify a beneficiary and their family members | M1 | **PASS** — member-level check-in; search is now camp-scoped via `resolveCampScope` |
| 10 | Distribution quantities calculated from configured family-based rules | M1 | **PASS** — `per_head` / `family_band` / `fixed` engine, Admin-configurable |
| 11 | Duplicate daily distribution blocked with a clear message | M1 | **PASS** — `409 ALREADY_DISTRIBUTED` on the `period_key` unique index |
| 12 | Inventory decreases correctly after distribution | M1 | **PASS** — verified live: exactly the ration, no drift |
| 13 | Low-stock **and expiry** alerts visible on the Admin dashboard | M1 | **PASS** — `dashboard.service.js:41-42` computes `near_expiry` and `expired`; rendered at `DashboardPage.jsx:81-83`, colour-toned when non-zero |
| 14 | Volunteer duties assigned to accepted individuals and tracked to completion | M1 | **PASS** — assign → active → complete with hours |
| 15 | Complaints **and SOS** created, routed, tracked to resolution | M1 / **E** | **SPLIT** — complaints **PASS** (§6.10 built in full, incl. the five-status lifecycle and camp routing). **SOS is not built** → M2 |
| 16 | Medical/security emergencies route to the camp's linked hospital/police contact | **E** | **M2** — the data is already in place: `nearest_hospital_contact` / `nearest_police_contact` are required camp fields (`camp.model.js:70-73`) |
| 17 | Donors record fund and material donations, receive a unique Donation ID | **F** | **M2** |
| 18 | Fund requests approved/rejected/partially approved and linked to expenses | **F** | **M2** |
| 19 | Expenses store supporting bill/receipt references | **F** | **M2** |
| 20 | Received / utilized / remaining computed from stored transactions only | **F** | **M2** |
| 21 | Donor-specific utilization viewable by that donor | **F** | **M2** |
| 22 | Dashboard shows separately labelled registered and checked-in counts, alongside inventory, financial, flood, volunteer and emergency statistics | M1 + **E** + **F** | **PARTIAL, as designed** — registered vs checked-in are separate figures (`DashboardPage.jsx:68-69`), and inventory, flood and volunteer areas are live. **Financial** arrives with F, **Emergency** with E. This is the incremental dashboard §7.1 specified, not a gap |
| 23 | AI predictions display without altering operational records | **G** | M3 |
| 24 | Reports filterable across all major operational areas | **G** | M3 |
| 25 | Critical operations fully auditable | M1 | **PASS** — `recordAudit` in 8 of 10 modules; the two without it (`notifications`, `dashboard`) are read-only projections with no state change to audit |

## Consequences for Milestone 2

The read-through converts five §16 lines into hard obligations that M2's spec must satisfy,
beyond a plain reading of §6.11–6.14:

1. **#15 and #16 together** mean SOS is not done when a record can be created — it is done
   when a medical emergency demonstrably reaches the *right camp's* hospital contact and the
   response timeline is tracked to resolution.
2. **#20** forbids a stored `total_utilized` or `remaining_balance` field. Those figures must
   be derived by aggregation at read time, the same rule §18 already imposes on the
   dashboard. This is a schema constraint, not a UI preference.
3. **#21** requires a donor-facing utilization view, so donation → expense traceability has to
   survive as a queryable link, not just a foreign key nobody reads.
4. **#22** means each of E and F ships its dashboard area as part of its own work, rather
   than leaving the dashboard to a later cleanup pass.

## Milestone 1 status

**Complete.** All 15 applicable acceptance criteria pass. Test suite: server 212/212,
client 55/55, shared 86/87 — the single shared failure being the pre-existing
`camp.schema` facilities-default drift documented in the Plan 4 verification record, which
reproduces identically on the pre-Plan-3 commit and is a zod version issue, not M1 work.
