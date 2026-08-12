# Plan 2 Verification — Areas & Camps (Milestone 1, slices 3–4)

**Date:** 2026-08-12
**Against:** live MongoDB Atlas cluster (same `.env` used for Plan 1's verification), real running server (`node server.js`) with Socket.IO attached, not the in-memory test harness.

## Automated suite

- Server: `npm test --workspace server` → **14 test files, 101 tests, all passing.**
- Client: `npm test --workspace client` → **6 test files, 18 tests, all passing.**
- The race test in `camps.service.test.js` (`Promise.all` racing two reservations for the last bed) passed, proving the atomic compare-and-swap guard under real concurrent contention, not just by inspection.

Two real defects were found and fixed while getting to green (see commit `e865378`):
1. `validate.js` reassigned `req.query = result.data`, which throws in Express 5 (`req.query` is a getter-only accessor that re-parses the URL on every read — neither reassignment nor in-place mutation sticks). Query-validated routes now read from `req.validatedQuery` instead.
2. `camps.test.js`'s own "filters by status" fixture used a 1-character camp name (`'A'`) against `createCampSchema`'s `min(2)`, so the POST silently 400'd and the test asserted against zero created camps by coincidence of both branches returning empty. Fixed the fixture's camp name.

## Manual checks against slices 3–4's "done when" (spec §10)

All performed via `curl` against the real server (`http://localhost:4000`) with the real `.env` Atlas connection, per the same pattern as Plan 1's Task 12.

| # | Check | Result |
|---|-------|--------|
| 1 | Admin signs in, records an affected area (`POST /api/areas`) → appears in `GET /api/areas` | **PASS** — "Ward 12" created, immediately listed. |
| 2 | Admin raises a flood alert against that area → appears in `GET /api/alerts/active` with the area name populated | **PASS** — alert "Water level rising fast." returned with `area_name: "Ward 12"`. |
| 3 | Admin creates a camp with the full §6.3 field set → appears in `GET /api/camps` with `0 / capacity` occupancy and status **Open** | **PASS** — "Riverside Community Hall" created: `beneficiaries_accepted: 0`, `beneficiary_capacity: 400`, `status: "open"`. |
| 4 | Admin sets `admin_override` on the camp; a connected Socket.IO client receives `camp:occupancy` for the change without polling | **PASS** — `PATCH` to `temporarily_closed` changed `status` in the response; a real `socket.io-client` connected to the live server received `camp:occupancy` the moment a subsequent update fired (payload: `{campId, beneficiaries_accepted, beneficiary_capacity, volunteers_accepted, volunteer_capacity, status}`), confirming the server-to-client wiring works outside of tests, not just inside `socket.test.js`'s throwaway `http.Server`. A true two-browser-tab check wasn't run in this environment; the client hook (`useLiveCampUpdates`) itself is covered by its own unit test (`socket.test.jsx`), and this check confirms the server side of that contract independently. |
| 5 | `GET /api/camps/nearest?latitude=...&longitude=...` returns the created camp | **PASS** — returned with `distance_meters: 0` (query point == camp location). |
| 6 | `POST /api/areas` and `POST /api/camps` as a donor → both refused | **PASS** — both returned `403`, proving server-side role enforcement independent of any UI. |
| 7 | `audit_logs` in Atlas has entries for `area.create`, `alert.create`, `camp.create`, `camp.update`; no secrets in any entry | **PASS** — 5 entries found (`camp.update` ×2, `camp.create`, `alert.create`, `area.create`); scanned for `password`/`password_hash`/`refresh_token`/`jwt`/`hmac`/`pepper` substrings — none present. |

## Known gaps (deferred by design, not defects)

- Actually calling `reserveBeneficiarySlots` from a real registration flow is Plan 3's job — until then its only caller is the test suite itself.
- Camp-detail/edit UI beyond the create form and admin-override PATCH isn't built.
- Resolving a flood alert (`FloodAlert.status → 'resolved'`) has no route yet; not required by slices 3–4's "done when".
- Leftover test data from this verification (`Ward 12` / `North District` area, alert, and camp; a `Donor Test` account) remains in the dev Atlas database, same as Plan 1's verification — flagged, not deleted.

## Conclusion

Plan 2 (Milestone 1, slices 3–4: Affected Areas + Camps) is **complete and verified** against both the automated suite and the spec's own "done when" criteria, run against the real system.
