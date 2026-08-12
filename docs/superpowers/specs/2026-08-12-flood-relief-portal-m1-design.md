# Flood Relief Camp Portal — Milestone 1 Design

**Date:** 2026-08-12
**Source of truth:** `Requirements/Flood_Relief_Portal_Requirements_v2.docx` (v2.0 Final Consolidated Edition)
**Status:** Approved — ready for implementation planning
**Target:** Production deployment

---

## 1. Purpose and context

This document specifies **Milestone 1** of the Web-Based Flood Relief Camp Beneficiary
Registration and Resource Distribution Portal.

The requirements document defines 20 functional modules across 22 MongoDB collections.
That is a platform, not a project. Building all of it against one spec produces work that
is 60% complete in every direction and finished in none. It is therefore decomposed into
sequenced sub-projects, each with its own spec → plan → build → verify cycle.

This document covers Milestone 1 only. Later milestones get their own specs.

### 1.1 Decomposition

Modules grouped by dependency:

| Group | Contents | Depends on |
|-------|----------|------------|
| **A. Foundation** | auth, RBAC, users, audit log, notifications | — |
| **B. Camp ops** | affected areas, flood alerts, camps + dual capacity | A |
| **C. Intake** | registration, family members, Aadhaar dedup, priority, volunteer FCFS, Beneficiary ID, check-in | B |
| **D. Relief ops** | resource master, inventory, distribution rules, distribution + duplicate-block, volunteer duties | C |
| **E. Response** | complaints, SOS + hospital/police routing | B |
| **F. Money** | donors, donations, fund requests, expenses, bills | B |
| **G. Insight** | admin dashboard Finance/Emergency/AI areas, reports, AI resource prediction service | C–F |

The dashboard is split across milestones rather than owned wholly by G: M1 builds the shell
and the areas whose underlying data exists (Camps, Beneficiaries, Volunteers, Inventory,
plus affected-area counts). Groups E, F, and G each extend it with their own areas as those
modules land. See §7.1.

**Milestone 1 = A + B + C + D.** This is the smallest set under which a relief camp can
actually operate: register families, verify them, and distribute rations against tracked
stock. Groups E, F, and G follow as separate specs.

### 1.2 Decisions taken during brainstorming

| Decision | Choice |
|----------|--------|
| Build purpose | Real production deployment |
| Milestone 1 scope | Groups A + B + C + D |
| Aadhaar storage | HMAC index + AES-256-GCM at rest + last-4 for display |
| Uniqueness semantics | One **active** registration per Aadhaar at a time |
| Intake schema | Registration header + single member collection |
| Database | MongoDB Atlas (replica set → transactions available) |
| Ration rules | Hybrid mode-based engine (`per_head` / `family_band` / `fixed`) |
| Real-time | Socket.IO **in** M1 |
| Seed / demo data | **In** M1 |
| Swagger / OpenAPI | Deferred |
| Deployment config | Deferred |
| Backend structure | Modular monolith, sliced by feature |
| Build order | Vertical slices |
| Client server-state | TanStack Query |
| Shared domain logic | Fourth workspace package, `shared/` |

---

## 2. Resolved contradictions in the source document

Three points in the requirements document cannot be implemented as literally written.
Each resolution below preserves the document's intent while making it buildable.

### 2.1 Aadhaar storage — spec says plaintext, production forbids it

§6.5 and the §9 ER diagram both specify `aadhaar (unique)` as a plain 12-digit field.
Under the Aadhaar Act 2016 and UIDAI regulations, storing Aadhaar numbers in the clear is
prohibited: they must be encrypted at rest, and only the last four digits may be displayed.
A single database leak would expose the identity of every flood victim in the system.

**Resolution.** Three fields replace one, satisfying every functional requirement:

| Field | Purpose |
|-------|---------|
| `aadhaar_hash` | HMAC-SHA256 with a server-held pepper. Deterministic → exact-match unique index → dedup works identically to a plaintext unique index. |
| `aadhaar_enc` | AES-256-GCM ciphertext, for lawful retrieval only. |
| `aadhaar_last4` | Plaintext last four digits, for display and visual verification at check-in (`XXXX XXXX 1234`). |

Name, mobile, and address remain plaintext, so §6.5's secondary-signal matching is
unaffected. The HMAC pepper and AES key are separate secrets, supplied by environment
variables, never committed.

### 2.2 Uniqueness — §7 says warn, §13 says hard constraint

- §7: possible duplicates "generate warnings for review rather than automatic silent rejection."
- §13: Aadhaar "validated as unique per individual across the system"; §19 asks for uniqueness indexes.

These are mutually exclusive. Further, a hard global unique index means a person sheltered
in Camp A during a June flood can never register anywhere again — the September flood locks
them out permanently.

**Resolution — both rules apply, to different things:**

| Layer | Rule | Behaviour |
|-------|------|-----------|
| **Hard** (§13) | Partial unique index on `aadhaar_hash` where `is_active_registration: true` | A person cannot hold two active registrations — not at two camps, not twice at one camp. Enforced by the database. Once a registration closes, they may register again in a future disaster. Full history retained. |
| **Soft** (§6.5, §7) | Fuzzy match on name + mobile + address | Sets a `duplicate_warning` flag on the member for official review at check-in. Never blocks submission. |

The intent of the rule — stopping one person drawing rations twice at the same time — is
fully preserved. Returning victims are not locked out.

### 2.3 Two collections cannot share one unique index

§8 specifies `beneficiaries` (applicant) and `family_members` as separate collections, each
carrying its own `aadhaar`. MongoDB cannot enforce a unique index spanning two collections,
so "unique per individual across the system" is unenforceable under that shape.

The §9 ER diagram already repeats an identical attribute set on both entities — `aadhaar`,
`is_pregnant`, `has_disability`, `priority_level (auto)`, `wants_to_volunteer`,
`volunteer_status / task`. That repetition indicates one entity, not two.

**Resolution.** `family_members` becomes `registration_members`, holding **every**
individual including the applicant, distinguished by `is_primary`. `beneficiaries` becomes
the registration header. No field from the document is lost; only the container changes.

---

## 3. Architecture

npm-workspaces monorepo. Three deployables, the third arriving in a later milestone.

```
FloodReliefCamp/
├─ Requirements/                    source requirements (untouched)
├─ docs/superpowers/specs/          this design and later specs
├─ shared/                          domain logic shared by client and server
├─ server/                          Express + Mongoose REST API
├─ client/                          React + Vite + MUI
└─ ai-service/                      Python + FastAPI predictor  (Module G, deferred)
```

### 3.1 `shared/` workspace

Pure, dependency-free domain logic imported by **both** client and server, so validation
cannot drift between browser and API:

- Zod schemas for every request payload
- `isValidAadhaar()` — 12 digits **plus Verhoeff checksum** (the real Aadhaar standard;
  §13's "standard 12-digit format" implies it, and it catches typos before they poison the
  dedup index)
- `derivePriority(person)` — priority tags and level
- `calcRation(rule, members)` — ration quantity from a distribution rule

### 3.2 `server/` — modular monolith, sliced by feature

**Ownership rule:** exactly one module owns each collection. Other modules reach it through
that module's *service*, never its model. This is what keeps capacity counters and inventory
from being mutated in six different places.

```
server/src/
├─ config/        env schema + validation, Atlas connection, index creation
├─ core/          errors, logger, auditLog, crypto (Aadhaar HMAC + AES),
│                 idGenerator, socket, withTransaction, idempotency
├─ middleware/    authenticate, authorize(roles), validate(zod), errorHandler, rateLimit
└─ modules/
   ├─ auth/          users, signup, login, JWT, refresh, official approval
   ├─ areas/         affected_areas, flood_alerts
   ├─ camps/         camps, capacity counters, geo, nearest-camp
   ├─ intake/        beneficiaries, registration_members, camp_checkins,
   │                 dedup, priority, volunteer FCFS, Beneficiary ID, check-in
   ├─ resources/     resource_items, inventory, distribution_rules
   ├─ distribution/  distribution_records, duplicate-block, stock deduction
   ├─ volunteers/    duty assignment and completion (via intake's service)
   ├─ notifications/ in-app notifications
   └─ audit/         audit_logs read API
```

Each module folder contains `*.model.js`, `*.service.js`, `*.controller.js`, `*.routes.js`,
`*.schema.js`, `*.test.js`.

### 3.3 `client/` — React + Vite + MUI

```
client/src/
├─ api/          axios instance, TanStack Query hooks per module
├─ features/     mirrors server module names
├─ components/   shared UI primitives
├─ layouts/      one shell per role
├─ routes/       route guards
└─ theme/        MUI theme
```

TanStack Query owns server state. Socket.IO events **invalidate query keys** rather than
pushing state directly, so live updates travel the same code path as an ordinary fetch.

---

## 4. Data model

### 4.1 Collections in Milestone 1 (14)

`users` · `audit_logs` · `notifications` · `affected_areas` · `flood_alerts` · `camps` ·
`beneficiaries` · `registration_members` · `camp_checkins` · `resource_items` · `inventory` ·
`distribution_rules` · `distribution_records` · `counters`

Deferred with their modules: `complaints`, `sos_requests`, `donors`, `donations`,
`donation_materials`, `fund_requests`, `expenses`, `expense_documents`, `resource_predictions`.

### 4.2 Declared deviations from §8

| # | Deviation | Forced by |
|---|-----------|-----------|
| 1 | `family_members` → `registration_members`, holding the applicant via `is_primary` | §13 cross-system uniqueness; no MongoDB index spans two collections (§2.3 above) |
| 2 | `camp_checkins` retained as an **event log** alongside a denormalised `checkin_status` on each member | §15 requires an audit record of who verified whom and when; the denormalised field keeps distribution-screen reads fast |
| 3 | `counters` collection added | §7 requires unique Beneficiary IDs; generating `BEN-1025` by counting documents races under concurrent submission. Atomic `$inc` with upsert is the only race-free method |

All other collections keep the names and purposes given in §8.

### 4.3 Key schemas

**`beneficiaries`** — registration header
```
_id, beneficiary_code "BEN-1025" (unique), user_id → users, camp_id → camps,
status: applied | partially_checked_in | active | closed,
duplicate_warning: bool, applied_at, closed_at
```

**`registration_members`** — every individual, applicant included
```
_id, beneficiary_id → beneficiaries, is_primary: bool,
relation_to_applicant (null when primary),
name, age, gender, mobile (primary only), address (primary only),
aadhaar_hash, aadhaar_enc, aadhaar_last4,
is_pregnant, has_disability,
priority_level: high | normal,            ← derived, never settable
priority_tags: [senior_citizen|child|pregnant|disability],
wants_to_volunteer,
volunteer_status: not_requested | accepted | not_accepted_slots_full | active | completed,
volunteer_task, volunteer_shift, volunteer_hours,
checkin_status: pending | checked_in, checked_in_at,
is_active_registration: bool,             ← drives the partial unique index
duplicate_warning: bool

INDEX { aadhaar_hash: 1 } UNIQUE
  partialFilterExpression: { is_active_registration: true }
```

**`camps`** — all §6.3 field groups: identity, location (with `2dsphere`), flood context,
capacity and duration, facilities, management, emergency contacts, status. Plus live
counters `beneficiaries_accepted` and `volunteers_accepted`, maintained only by guarded
atomic updates.

**`distribution_rules`** — hybrid engine
```
item_id, camp_id (null = global default),
mode: per_head | family_band | fixed,
period: daily | weekly | once,
bands: [{ min, max, qty }],        (mode = family_band)
per_head_qty,                      (mode = per_head)
fixed_qty,                         (mode = fixed)
priority_addons: [{ when, extra_qty }],
eligibility (e.g. child-only items),
min_qty, max_qty, effective_from, effective_to, active
```

**`distribution_records`**
```
beneficiary_id, camp_id, item_id, quantity, period_key,
distributed_at, distributed_by → users, override_reason (null unless unverified)

INDEX { beneficiary_id, item_id, period_key } UNIQUE
```

---

## 5. Core invariants

These four determine whether the system is correct or worthless. Each is a pure,
unit-testable function plus a race-free persistence step.

### 5.1 Aadhaar deduplication

Two layers, per §2.2. The hard layer is a partial unique index; a colliding insert fails
atomically inside the registration transaction, nothing persists, and the API returns 409
naming the offending member (`"Meena, XXXX XXXX 4471"`) so the UI can flag exactly that
person. The soft layer sets `duplicate_warning` for official review and never blocks.

### 5.2 Priority classification

```
priority_tags  = [ age >= 60 && 'senior_citizen', age <= 12 && 'child',
                   is_pregnant && 'pregnant', has_disability && 'disability' ]
priority_level = priority_tags.length ? 'high' : 'normal'
```

Computed in a Mongoose `pre('validate')` hook, so it cannot be set from a request body —
satisfying §7's "never manually tagged". Tags are an array because §6.16 requires children,
senior citizens, pregnant women, and persons with disability to be counted **separately**;
a single enum could not answer that query.

### 5.3 Capacity — two counters, independently enforced

Beneficiary capacity, guarded so it cannot overshoot under concurrency:
```js
camps.findOneAndUpdate(
  { _id, $expr: { $lte: [ { $add: ['$beneficiaries_accepted', N] },
                          '$beneficiary_capacity' ] } },
  { $inc: { beneficiaries_accepted: N } })
// null ⇒ camp full ⇒ 409 + nearest-camp recommendation
```

Nearest camp uses `$near` on the `2dsphere` index, filtered to camps with remaining space
(§6.5, §7).

Volunteer capacity is enforced **per individual**, strictly first-come-first-served (§7).
If three members opt in and two slots remain, exactly two are accepted, in submission order
(applicant first, then family members as entered):
```js
granted = min(optedInCount, volunteer_capacity - volunteers_accepted)
// compare-and-swap guarded on the value observed inside the transaction,
// bounded retry on conflict ⇒ no double-grant under concurrent submissions
```
Members beyond the line receive `volunteer_status: 'not_accepted_slots_full'` and **remain
full beneficiaries**, exactly as §6.5 requires.

### 5.4 Distribution — duplicate-proof and stock-safe

One transaction, insert-first so the duplicate check cannot race:

```js
1. qty = calcRation(rule, checkedInMembers)          // pure, unit-tested
2. distribution_records.insert({ beneficiary_id, item_id, period_key })
   // period_key = '2026-08-12' | '2026-W33' | 'once'
   // duplicate key ⇒ "Already distributed today."
3. inventory.findOneAndUpdate(
     { _id, remaining_qty: { $gte: qty } },
     { $inc: { remaining_qty: -qty, distributed_qty: qty } })
   // null ⇒ insufficient stock ⇒ abort transaction
4. audit_log + low-stock notification if threshold crossed
```

All-or-nothing; requires the Atlas replica set.

**Verification policy.** §7 says beneficiaries "should **normally** be checked-in/verified
before resource distribution" — deliberately not absolute. Distribution to an unverified
beneficiary is therefore blocked by default, with an official override that **requires a
recorded reason** and is audited. A database constraint should not be the thing that refuses
an unverified but starving family.

---

## 6. API and authorization

- **JWT access token (15 min) + rotating refresh token in an httpOnly cookie.** bcrypt cost 12.
- **`authorize(...roles)` on every protected route, plus resource scoping** — a Camp Official
  may act only on their assigned camp. §12 requires this server-side, not only in frontend
  route guards.
- **Zod validation** from `shared/` through one `validate()` middleware.
- **`withAudit()`** wraps every critical mutation, recording actor, role, action, module,
  record id, and previous/new values per §15, so auditing cannot be forgotten on a new route.
- Rate limiting on auth endpoints. Uniform error envelope.

```
POST /api/auth/{signup,login,refresh,logout}      GET  /api/auth/me
GET|POST|PATCH /api/areas                         GET|POST|PATCH /api/camps
GET  /api/camps/nearest?lat&lng                   PATCH /api/camps/:id/status
POST /api/registrations                           ← intake transaction
GET  /api/registrations/me | :code | ?search=     ← official search: code | mobile | name
POST /api/registrations/:id/members/:mid/checkin  ← per-individual, partial family
POST /api/volunteers/:memberId/{assign,complete}
GET|POST /api/{resources,inventory,distribution-rules}
POST /api/distributions                           ← distribution transaction
GET  /api/distributions?beneficiary=&camp=&date=
GET  /api/notifications                           GET /api/audit-logs
```

---

## 7. Frontend

### 7.1 Screens in Milestone 1 (24 of §11's 38)

Login/Signup · Landing with live alerts and open camps · Registration wizard (self +
Add Person) · Beneficiary ID success · Status lookup · Admin dashboard (M1 scope, see below) ·
Affected areas · Camp list · Create/edit camp · Camp details and occupancy · Beneficiary
management · Beneficiary and family details · Check-in and verification · Distribution ·
Distribution history · Inventory dashboard · Inventory add/edit · Stock movement history ·
Low-stock and expiry alerts · Distribution rules editor · Volunteer task assignment ·
Volunteer duty dashboard · Notification centre · Audit log viewer.

**Admin dashboard scope in M1.** §6.16 defines eight dashboard areas, but four of them
(Finance, Emergency, and the AI panel) report on modules that do not exist until Groups E, F,
and G. M1 therefore builds the dashboard shell plus the four areas whose data exists:
**Camps, Beneficiaries, Volunteers, Inventory**, together with the Flood Monitoring area
limited to affected-area counts. Every figure is computed from stored data by aggregation
pipeline, never manually entered (§18), and registered versus checked-in counts are shown as
separate, clearly labelled figures (§6.16). The remaining areas are added by their own
milestones, extending the same shell.

Deferred with their modules: complaint/SOS forms, all donor and finance screens, AI
prediction, reports.

### 7.2 The registration wizard

§13 requires that the UI "must not silently lose entered data on recoverable validation
failures." Form state is drafted to `sessionStorage`. A 409 duplicate-Aadhaar response
identifies **which member** collided; the wizard re-renders with that person flagged and
every other person's entries intact. Losing a family of seven's details because member five
had a typo is precisely the failure that makes camp staff abandon a system.

### 7.3 Real-time

Socket.IO events `camp:occupancy`, `inventory:changed`, `inventory:low_stock` invalidate
TanStack Query keys. Live occupancy on the landing page (§6.2) and low-stock alerts (§6.8)
are the M1 consumers.

---

## 8. Errors, validation, idempotency

Uniform envelope:
```json
{ "error": { "code": "DUPLICATE_AADHAAR", "message": "...", "details": [ { "path": "...", "message": "..." } ] } }
```
`details[]` carries field paths the client maps to inline field errors.

§12 requires safe handling of duplicate submissions, so `POST /registrations` and
`POST /distributions` accept an **`Idempotency-Key`** header; a repeated key returns the
original response rather than creating a second registration when a user double-taps on a
poor connection. `withTransaction()` retries on `TransientTransactionError`.

---

## 9. Testing

Test-driven: failing test → implementation → refactor.

- **Backend:** Vitest + Supertest against `MongoMemoryReplSet` — an in-memory *replica set*,
  so transactions run in tests offline, without touching Atlas.
- **Concurrency tests are the ones that matter.** Every invariant gets a race test:
  parallel registrations against **1 remaining bed**; parallel opt-ins against **1 remaining
  volunteer slot**; parallel distributions for the **same beneficiary + item + day**. These
  are the only way to know the guards work rather than merely look correct.
- **Frontend:** Vitest + React Testing Library on the wizard, check-in, and distribution screens.
- 100% branch coverage on the invariant functions in `shared/` and the module services;
  meaningful coverage elsewhere.

---

## 10. Delivery plan — 9 vertical slices

Each slice delivers model + API + validation + UI + tests together, and is demonstrable the
day it lands.

| # | Slice | Done when |
|---|-------|-----------|
| 1 | Foundation: workspaces, config, Atlas connection, error envelope, logger, audit core, test harness | health check green, audit write proven by test |
| 2 | Auth: users, JWT + refresh, RBAC, official approval, bootstrap admin seed | role-gated routes proven; login works end to end |
| 3 | Affected areas + flood alerts | admin records an area; alert appears |
| 4 | Camps: full §6.3 field set, dual capacity, status lifecycle, geo, nearest-camp | camp created; landing page lists it with live occupancy |
| 5 | Intake: registration transaction, Aadhaar crypto + dedup, priority, Beneficiary ID | family registers and receives BEN-1025; duplicate blocked; race test passes |
| 6 | Volunteer FCFS per individual | 3 opt in against 2 slots → exactly 2 accepted, in order |
| 7 | Check-in: per-individual, partial family, event log, official search | official finds by code/mobile/name and verifies 2 of 4 members |
| 8 | Resources, inventory, thresholds, expiry alerts, hybrid rule editor | admin configures a rice rule; stock visible with alerts |
| 9 | Distribution: ration calc + duplicate block + atomic deduction + volunteer duties | stock drops on distribution; same-day repeat blocked |

Socket.IO is wired in at slices 4 and 8–9, where live data first exists. The seed script
begins at slice 2 (bootstrap Admin) and grows with each slice.

A final pass verifies Milestone 1 against every applicable line of §16 Acceptance Criteria.

---

## 11. Out of scope for Milestone 1

Deferred to later specs, in this order: **E** (complaints, SOS routing) → **F** (donors,
donations, fund requests, expenses) → **G** (reports and the AI prediction microservice).
Each of E, F, and G also contributes its own area to the admin dashboard shell built in M1
(§7.1): Emergency from E, Finance from F, and the AI panel from G.

Also deferred, per explicit decision: Swagger/OpenAPI documentation and deployment
configuration (Dockerfiles, environment templates, production build).

Out of scope permanently, per §3.2 of the requirements: OTP/SMS verification, mandatory
QR-code check-in, third-party KYC integration, and Hospital/Police login accounts.
