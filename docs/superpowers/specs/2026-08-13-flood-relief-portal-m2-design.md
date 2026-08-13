# Flood Relief Camp Portal — Milestone 2 Design

**Response and Money — Groups E and F**

Source: `Requirements/Flood_Relief_Portal_Requirements_v2.docx`
Predecessor: `docs/superpowers/specs/2026-08-12-flood-relief-portal-m1-design.md`
Gate passed: `docs/superpowers/plans/2026-08-13-m1-acceptance-criteria-readthrough.md`

---

## 1. Purpose and context

Milestone 1 delivered Groups A–D: a camp can register families, deduplicate them by
Aadhaar, verify them physically, and distribute rations against tracked stock. It closed
with all 15 applicable §16 acceptance criteria passing.

Milestone 2 delivers **Group E (Response)** and **Group F (Money)**. After M2 a camp can
also raise and resolve emergencies with routing to the linked hospital or police contact,
and the organisation can accept donations, request funds, approve them, spend them against
recorded bills, and show every donor exactly what their money bought.

This document covers Milestone 2 only. Group G (reports, AI resource prediction, and the
remaining dashboard areas) gets its own spec as Milestone 3.

### 1.1 Position in the group decomposition

| Group | Contents | Depends on | Status |
|-------|----------|------------|--------|
| A. Foundation | auth, RBAC, users, audit log, notifications | — | M1 ✅ |
| B. Camp ops | affected areas, flood alerts, camps + dual capacity | A | M1 ✅ |
| C. Intake | registration, dedup, priority, volunteer FCFS, check-in | B | M1 ✅ |
| D. Relief ops | resource master, inventory, distribution, volunteer duties | C | M1 ✅ |
| **E. Response** | complaints, **SOS + hospital/police routing** | B | complaints ✅ · **SOS = M2** |
| **F. Money** | donors, donations, fund requests, expenses, bills | B | **M2** |
| G. Insight | reports, AI prediction, Finance/Emergency/AI dashboard areas | C–F | M3 |

**Complaints (§6.10) already shipped**, ahead of sequence, during M1 delivery — the
`complaints` module, its five-status lifecycle (`open · under_review · in_progress ·
resolved · rejected`), camp-scoped routing to the assigned official, and reporter
notifications are all live and tested. Group E therefore reduces to SOS.

Three further pieces of M2 groundwork already exist and must be built **on**, not beside:

- `donor` is already a member of `ROLES` (`shared/src/schemas/auth.schema.js:3`). Donors
  can sign up and authenticate today; they have no screens and no profile.
- Camps already require `nearest_hospital_name` / `nearest_hospital_contact` /
  `nearest_police_name` / `nearest_police_contact` (`server/src/modules/camps/camp.model.js:70-73`).
  SOS routing needs no schema change to `camps`.
- `resolveCampScope()` in `intake.service.js` is the established pattern for restricting a
  camp official to their assigned camps. Every camp-scoped read in M2 uses it.

### 1.2 Decisions taken during brainstorming

| Decision | Choice |
|----------|--------|
| Milestone 2 scope | Groups E + F |
| Material donations vs inventory | Post to stock **on admin confirmation**, through the inventory *service* |
| Financial donations | Also require admin confirmation before counting toward available funds |
| SOS routing meaning | Resolve and stamp the camp's contact, surface it to the handler, track the response timeline |
| Donor utilization traceability | **Explicit allocation**, FIFO proposed, approver-overridable |
| Bill / document storage | **Real upload to local disk**, auth-gated download, adapter for later S3 |
| Payment gateway | None. Donations are *recorded*, never *transacted* (§20) |
| Plan decomposition | Four sequential full-stack plans, as M1 |

---

## 2. Constraints inherited from the §16 read-through

The acceptance-criteria pass converted five §16 lines into hard obligations. They are
repeated here because three of them are **schema** constraints, not UI preferences, and
getting them wrong is expensive to undo later.

### 2.1 #20 — no stored totals

> "The system must calculate total received, total utilized, and remaining amount from
> recorded transactions — never from manually typed totals."

There is **no `total_received`, `total_utilized`, or `remaining_balance` field** on any M2
collection. Every such figure is an aggregation pipeline over `donations` and `expenses`
evaluated at read time. This is the discipline `dashboard.service.js` already applies to
camp occupancy, extended to money.

The temptation to denormalise will be real — a donor's utilization view aggregates across
two collections. Resist it. A stored total is a number that can silently disagree with the
transactions beneath it, and in a finance context that is not a performance optimisation,
it is a defect.

### 2.2 #21 — donor-specific utilization must be answerable

A donor must be able to see the utilization of **their own** contribution. That requires a
durable link from an expense back to the donations that funded it. §3.2 below specifies it.

### 2.3 #15 and #16 together — SOS is not done at "record created"

SOS is done when a medical emergency demonstrably reaches the *correct camp's* hospital
contact and the response is tracked **to resolution**. A create endpoint alone does not
satisfy these criteria.

### 2.4 #22 — each group ships its own dashboard area

The M1 dashboard is a shell with four live areas. E contributes **Emergency**; F
contributes **Finance**. Each lands as part of its own plan, not as a later cleanup pass.

---

## 3. Data model

### 3.1 New collections in Milestone 2 (7)

`sos_requests` · `donors` · `donations` · `donation_materials` · `fund_requests` ·
`expenses` · `expense_documents`

All seven are named in requirements §8. No collection is invented. Milestone 2 brings the
database to **23 collections** (15 from M1 + `complaints` + these 7).

`counters` gains **four** new sequences — `sos_code`, `donation_code`,
`fund_request_code`, `expense_code` — handing out `SOS-1001` / `DON-1001` / `FR-1001` /
`EXP-1001`. The atomic `$inc`-with-upsert in `server/src/core/idGenerator.js` is the only
race-free way to do this; counting documents races under concurrent submission.

That file currently holds two near-identical functions, `nextBeneficiaryCode` and
`nextComplaintCode`, differing only in counter key and prefix. Adding four more by
copy-paste would make six. Plan 1 generalises them to a single
`nextCode(counterKey, prefix, session)` and re-expresses the two existing functions in
terms of it — a small, contained refactor of code M2 is about to quadruple the size of,
not unrelated cleanup.

### 3.2 Declared deviations from §8

| # | Deviation | Forced by |
|---|-----------|-----------|
| 1 | `expenses.funding_allocations` is an **array** of `{donation_id, amount}`, where §6.14 lists a single `Donation ID (if applicable)` | A ₹50,000 expense may legitimately draw on three ₹20,000 donations. A scalar field can represent this only by splitting one real expense into three fictitious ones, which corrupts the expense record and the bill attached to it. The single-donation case is simply an array of length 1 |
| 2 | `donors` is a **profile** collection keyed by `user_id`, not a parallel account store | §6.12 requires donor signup "via the common authentication flow", and `users` already carries the `donor` role. A second account store would fork authentication. The `auth` module keeps sole ownership of `users` (§3.2 of the M1 spec) |
| 3 | `expense_documents` also serves **fund requests** (`Supporting Document`, §6.14), via a polymorphic `owner_type` / `owner_id` | §8 names one document collection; §6.14 attaches documents to two different entities. One collection with one upload path, one authorization check, and one storage adapter is safer than two near-duplicates |

Allocations are **embedded** on the expense rather than given their own collection because
an allocation has no life independent of its expense — it is created with it, deleted with
it, and never queried without it.

### 3.3 Key schemas

**`sos_requests`**
```
sos_code            'SOS-1001', unique, from counters
camp_id             ref camps, required
reported_by         ref users
category            medical | security | food_shortage | water_shortage |
                    missing_person | other                        (§6.11 verbatim)
urgency             critical | high | medium | low
description         string, required
location            free text — where in/near the camp
routed_to_type      hospital | police | camp_admin
routed_to_name      string   ) copied from the camp at creation,
routed_to_contact   string   ) NOT a live reference — see §5.2
status              open | acknowledged | responding | resolved | closed
timeline            [{ status, actor_id, at, note }]
resolution          string, required when resolved
resolved_at         date
```
Index `{ camp_id: 1, status: 1, urgency: 1 }` — the Emergency dashboard's only query
shape. Index `{ status: 1, createdAt: -1 }` for the admin's cross-camp open list.

**`donors`**
```
user_id             ref users, unique, required
donor_type          individual | ngo
name                string                    (individual) / organization name (ngo)
contact_person      string, required when ngo
mobile, email, address
registration_details string, required when ngo   (§6.12)
```

**`donations`**
```
donation_code       'DON-1001', unique
donor_id            ref donors
donation_type       financial | material
target_camp_id      ref camps, nullable — a general donation targets no camp
purpose             string
status              pending | confirmed | rejected
donated_at          date
-- financial only --
amount              number, > 0
payment_method      string
payment_reference   string          (§20: supports future gateway integration)
-- both --
confirmed_by, confirmed_at, rejection_reason
```
Material line items live in `donation_materials` (`donation_id`, `resource_item_id`,
`item_label`, `category`, `quantity`, `unit`, `estimated_value`, `remarks`), one document
per item, because §6.13 gives material donations item-level detail and a single donation
may carry several items.

**`fund_requests`**
```
request_code        'FR-1001', unique
camp_id             ref camps, required
requested_by        ref users
amount              number, > 0
purpose, category, description
status              pending | approved | partially_approved | rejected   (§6.14 verbatim)
approved_amount     number — 0 when rejected, ≤ amount otherwise
reviewed_by, reviewed_at, review_note
```
Index `{ camp_id: 1, status: 1 }`.

**`expenses`**
```
expense_code        'EXP-1001', unique
fund_request_id     ref fund_requests, required
camp_id             ref camps, required
expense_date        date
category            food | water | medicine | transportation | accommodation |
                    blankets | hygiene | infrastructure | fuel | other   (§6.14 verbatim)
description, vendor, payment_reference
amount              number, > 0
funding_allocations [{ donation_id, amount }]      -- see §3.2 deviation 1
status              pending | approved | rejected
requested_by, approved_by, remarks
```

**`expense_documents`**
```
owner_type          expense | fund_request
owner_id            ObjectId
camp_id             ref camps      -- denormalised so download authz needs one read
stored_name         generated, opaque       ) the original name is metadata,
original_name       string, display only    ) never a path component
mime_type, size_bytes, checksum_sha256
uploaded_by, uploaded_at
```

---

## 4. Core invariants

### 4.1 Confirmation gates the money

A donation is created `pending`. **Only a `confirmed` donation counts** toward available
funds or posts stock. An admin confirms or rejects.

This is not bureaucracy: without it, any authenticated donor could type ₹50,00,000 into a
form and every camp's available-funds figure would rise accordingly. Rejection requires a
reason and is audited.

### 4.2 Material donations post stock through the inventory service

On confirmation of a material donation, each `donation_materials` line posts a stock
increase for `target_camp_id`. The call goes to the **inventory service**, never to the
`Inventory` model — the M1 spec's §3.2 module-ownership rule, which says one module owns
each collection and others go through its service.

Consequences that must hold:

- A material donation without a `target_camp_id` cannot be confirmed. Stock has to land
  somewhere. Validation rejects it at confirmation time with a clear message.
- Each line maps to an existing `resource_items` entry, so donated rice and procured rice
  are one stock line, not two. Confirmation fails if a line has no mapping.
- Posting happens inside the same transaction as the status change. A partial failure must
  not leave a donation `confirmed` with no stock behind it.
- The existing low-stock announcement fires naturally, since it already hangs off inventory
  changes.

### 4.3 Allocation can never exceed a donation

The sum of `amount` across every `funding_allocations` entry referencing a given donation
must never exceed that donation's confirmed `amount`.

Enforced inside `withTransaction()`: read the donation's current allocated total, add the
proposed amount, compare, abort if it exceeds. Two expenses racing for the last ₹5,000 of a
donation must end with exactly one succeeding.

FIFO — oldest confirmed donation for that camp first, general donations after camp-targeted
ones — is the *proposal* the server returns to the approver. The approver may override the
split. Whatever is submitted is re-validated server-side; the proposal is a convenience, not
a trusted input.

### 4.4 Expenses cannot exceed their approval

An expense's amount, summed with all other approved expenses against the same
`fund_request_id`, cannot exceed that request's `approved_amount`. A rejected or pending
fund request can carry no approved expense at all.

### 4.5 Every money figure is derived

```
total_received  = Σ donations.amount            where status = confirmed, type = financial
total_utilized  = Σ expenses.amount             where status = approved
remaining       = total_received − total_utilized
donor utilized  = Σ allocation.amount           over expenses, unwound, where
                    allocation.donation_id ∈ that donor's confirmed donations
donor remaining = donor total confirmed − donor utilized
```
No stored counterpart. Ever. (§2.1)

---

## 5. SOS

### 5.1 Who raises one

Affected persons (for their own camp) and camp officials (for their assigned camps, via
`resolveCampScope`). Admins see all. Donors cannot raise SOS requests — the same role
boundary already enforced on complaints.

### 5.2 Routing resolves at creation, and is copied

When a `medical` SOS is created, the server resolves the camp's `nearest_hospital_name`
and `nearest_hospital_contact` and **writes those values onto the SOS record**.
`security` resolves to the police contact. Every other category routes to `camp_admin`.

Copying rather than referencing is deliberate. If a camp's hospital contact is edited three
months later, the record of who was called during last month's emergency must not silently
change. This mirrors the M1 decision to keep `camp_checkins` as an event log.

The handler UI surfaces the routed-to name and number prominently — a phone number someone
has to dial under time pressure, not a field buried in a detail panel.

### 5.3 Tracked to resolution

`open → acknowledged → responding → resolved`, with `closed` for records raised in error.
Each transition appends `{status, actor_id, at, note}` to `timeline`. `resolved` requires a
resolution note, exactly as the complaints module requires one. Response time — created to
acknowledged — and resolution time are derived from the timeline, never stored.

### 5.4 Immediate visibility

§6.11 requires SOS to "display immediately on the Admin dashboard, flagged by urgency". New
and updated SOS requests broadcast over the existing Socket.IO channel to admins and to the
officials assigned to that camp, reusing the routing logic the complaints module already
established.

---

## 6. File upload

The one genuinely new piece of infrastructure in M2, and the one with the largest security
surface. §20 leaves the provider open and asks only for "secure file references/metadata"
with "authorization on access".

**Storage.** A server-side directory outside the web root and outside `client/dist`. The
stored filename is generated; the uploaded name is recorded as display metadata and never
used as a path component. Nothing in the upload path is ever interpolated into a filesystem
path.

**Accepted.** PDF, JPEG and PNG only, decided by sniffed content type rather than by
extension alone, capped at **10 MB** per file. A phone photograph of a receipt is
comfortably under that; the cap exists so a single upload cannot fill the disk. A SHA-256
checksum is recorded so a bill can later be shown not to have been swapped.

**Download.** Never a static route. A controller re-checks, on every request: the caller's
role, and — for camp officials — that the document's `camp_id` is within their assigned
camps. Served with `Content-Disposition: attachment` and an explicit non-sniffing content
type, so a crafted upload cannot execute in a viewer's browser.

**Adapter.** A narrow interface (`put`, `get`, `delete`) with a local-disk implementation.
Swapping to S3 or MinIO later is one new implementation and no changes to callers, which is
what §20 asks for.

---

## 7. API and authorization

New route groups, all under the existing `authenticate` middleware:

| Route | Admin | Camp official | Affected person | Donor |
|---|---|---|---|---|
| `POST /api/sos` | ✅ | ✅ own camps | ✅ own camp | ❌ |
| `GET /api/sos` | all | own camps | own only | ❌ |
| `PATCH /api/sos/:id` | ✅ | ✅ own camps | ❌ | ❌ |
| `POST /api/donors/me` | ❌ | ❌ | ❌ | ✅ own profile |
| `POST /api/donations` | ✅ | ❌ | ❌ | ✅ own |
| `PATCH /api/donations/:id/confirm` | ✅ | ❌ | ❌ | ❌ |
| `GET /api/donations/mine` | ❌ | ❌ | ❌ | ✅ |
| `GET /api/donations/mine/utilization` | ❌ | ❌ | ❌ | ✅ |
| `POST /api/fund-requests` | ✅ | ✅ own camps | ❌ | ❌ |
| `PATCH /api/fund-requests/:id/decision` | ✅ | ❌ | ❌ | ❌ |
| `POST /api/expenses` | ✅ | ✅ own camps | ❌ | ❌ |
| `PATCH /api/expenses/:id/decision` | ✅ | ❌ | ❌ | ❌ |
| `POST /api/documents` | ✅ | ✅ own camps | ❌ | ❌ |
| `GET /api/documents/:id` | ✅ | ✅ own camps | ❌ | ❌ |
| `GET /api/finance/summary` | ✅ | own camps | ❌ | ❌ |

A donor can read only their own donations and their own utilization. A donor cannot see
another donor's contribution, a camp's expenses, or any beneficiary data.

Two entries in that table need their reasoning stated, because both look at first glance
like authorization leaks:

- **`POST /api/donations` is open to admins**, not only donors. Real donations arrive by
  cheque, bank transfer and physical delivery from people who will never log in. An admin
  recording one supplies the `donor_id`, and the record carries `recorded_by` so a
  self-declared donation and a staff-recorded one are always distinguishable. An
  admin-recorded donation still requires confirmation by a *different* admin action; it is
  not confirmed on creation.
- **`GET /api/finance/summary` is open to camp officials, scoped to their own camps.** An
  official who may submit fund requests has to be able to see what their camp has left, or
  they are requesting money blind. They see camp totals — never donor identities, and never
  another camp's figures.

Route ordering matters, as it did in M1: `/donations/mine` and
`/donations/mine/utilization` are declared **before** `/donations/:id`, or Express matches
the literal segment as an id.

---

## 8. Frontend

Twelve screens, taking the implemented count from 25 (24 M1 + Complaint Management) to
**37 of §11's 39**:

**Group E** — SOS form (affected person) · SOS / Emergency dashboard (official, admin).

**Group F** — Donor/NGO profile · Donation entry (financial and material) · Donation
history · Donation utilization (donor-facing) · Fund requests (official) · Fund approval
(admin) · Expense entry · Expense review · Bills/receipts · Fund utilization dashboard
(admin).

Remaining after M2: AI Resource Prediction and Reports, both Group G.

> **Count correction.** The M1 spec (§7.1) says "24 of §11's 38". §11 in fact lists **39**
> screens — counted line by line during this spec's review. The M1 figure is off by one.
> M2 uses 39. The M1 screen *set* was correct; only the denominator was wrong.

All follow the M1 design tokens — `#FF6B00`/`#C44E00` brand orange, Lora + Public Sans,
14px card radius, CSS grid via `Box sx={{display:'grid'}}` rather than MUI `<Grid>`. Camp
scoping reuses `CampScope` / `CampBar`. Scoped queries use
`placeholderData: keepPreviousData`, for the reason M1 discovered the hard way: the camp
scope settles after mount, and without it every scoped list blanks on each camp switch.

---

## 9. Testing

The M1 bar, unchanged: per-module server tests against `MongoMemoryReplSet`, client tests
per screen, `pool: 'forks'` with `fileParallelism: false`.

Four areas need **adversarial** tests rather than happy-path coverage, because each is a
place where a plausible implementation is quietly wrong:

1. **Concurrent allocation** — two expenses racing for the last of a donation. Exactly one
   succeeds; the donation is never over-allocated.
2. **Upload rejection** — wrong mime type, oversize, traversal-shaped filenames, and a
   camp official attempting to download another camp's bill.
3. **Derived totals under partial failure** — a rejected donation must vanish from
   `total_received`; a rejected expense from `total_utilized`.
4. **Cross-role leakage** — donor B must not read donor A's donations or utilization; a
   camp official must not read another camp's fund requests, expenses, or SOS records.

M1 shipped a camp-scope bug precisely because every search test used an admin. Every M2
authorization test names the role it is testing **and** a role that must be refused.

---

## 10. Delivery plan — four sequential plans

| Plan | Delivers | Demonstrable at the end |
|---|---|---|
| **1. SOS** | `sos_requests`, routing resolution, timeline, Emergency dashboard area, both screens | Raise a medical SOS → the correct hospital contact appears on it → acknowledge → resolve |
| **2. Donors and donations** | donor profiles, financial + material donations, confirmation, stock posting, donor dashboard | Donor records 100kg rice → admin confirms → camp inventory rises → donor sees it |
| **3. Funds, expenses, bills** | fund requests, decisions, expenses, FIFO allocation, upload infrastructure | Official requests ₹50k → admin partially approves ₹30k → expense with bill attached → over-spend refused |
| **4. Utilization and Finance area** | donor utilization view, fund utilization dashboard, Finance dashboard area, §16 verification | Donor opens their utilization and sees exactly which expenses their money funded |

Each plan is full-stack and ends with a written verification record, as M1's four did.

A final pass verifies Milestone 2 against §16 criteria 15–22.

---

## 11. Out of scope for Milestone 2

Deferred to **Milestone 3 (Group G)**: AI resource prediction (§6.15) and its abstracted
prediction service, reports (§6.17), the AI dashboard area, and the §6.18 chatbot.

Deferred per earlier explicit decision, unchanged: Swagger/OpenAPI documentation and
deployment configuration.

**Payment processing is out of scope permanently.** §20 does not prescribe a gateway, and
donation records need only carry payment reference information for a future integration.
Milestone 2 *records* donations; it never *transacts* money.

Out of scope permanently, per requirements §3.2: OTP/SMS verification, mandatory QR-code
check-in, third-party KYC integration, and Hospital/Police login accounts — the last being
the reason SOS routing surfaces a contact rather than notifying an account (§5.2).
