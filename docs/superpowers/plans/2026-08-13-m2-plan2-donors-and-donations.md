# Milestone 2 — Plan 2: Donors and Donations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a donor create a profile, record a financial or material donation, have
an admin confirm or reject it, and — on confirmation of a material donation — post
that stock into the target camp's inventory. Closes requirements §6.12 and §6.13.

**Architecture:** One new `donations` module owning three collections (`donors`,
`donations`, `donation_materials`), sliced the same way `intake` owns three
(`beneficiaries`, `registration_members`, `camp_checkins`) — one service file, several
models. The one genuinely new capability outside that module is `receiveStock`, added
to the `resources` module (which already owns `Inventory`), so donations post stock
through *its* service, never its model — the module-ownership rule the M1 spec states
and M2's design doc reaffirms specifically for this case.

**Tech Stack:** Express 5, Mongoose 9 (`withTransaction`), zod v4, React 19, MUI 9,
TanStack Query v5, Vitest 4 + Supertest + `MongoMemoryReplSet`.

## Global Constraints

- **A donation is `pending` until an admin confirms or rejects it.** Only a
  `confirmed` donation counts toward anything — no stock, no future fund allocation.
  Rejection requires a reason (spec §4.1 of the M2 design).
- **Material donations post stock through `resources.service.js`'s `receiveStock`,
  never through the `Inventory` model directly.** Module-ownership rule, M1 spec §3.2,
  reaffirmed by the M2 design spec §4.2 specifically for this case.
- **A material donation without a `target_camp_id` cannot be confirmed** — stock has
  to land somewhere. This is a confirmation-time check, not a creation-time one; a
  donor may record a donation before a camp is decided.
- **Stock posting happens inside the same transaction as the donation's status
  change.** A partial failure must never leave a donation `confirmed` with no stock
  behind it (M2 design §4.2).
- **No stored totals, anywhere.** `total_received` is `Σ donations.amount` computed
  at read time — never a field on any document (M2 design §2.1, §4.5). This plan does
  not add a summary endpoint (that is Plan 4's job), but nothing in this plan may lay
  groundwork for one by caching a total.
- **An admin-recorded donation still requires an existing `donor_id`.** `donors.user_id`
  is a required, unique field per the M2 design's own schema (§3.3) — there is no
  parallel path for a donor with zero account. "An admin can record a donation on a
  donor's behalf" (M2 design §7) means for an *existing* donor profile who phoned in a
  cheque, not a walk-in stranger with no account at all. Flagging this now because the
  design doc's surrounding prose ("people who will never log in") reads more broadly
  than the schema it declared actually supports.
- **Every closing/deciding action is audited** (`recordAudit`, spec §15): donation
  creation, confirmation, and rejection.
- **`GET /api/donations` (admin, listable and filterable) is an addition beyond the
  M2 design spec's own §7 API table**, which lists only `POST /donors/me`, `POST
  /donations`, `PATCH /donations/:id/confirm`, `GET /donations/mine`, and `GET
  /donations/mine/utilization` — no plain admin list. Without one, an admin has no
  way to discover which donation ids are waiting on `PATCH .../confirm`. Flagging
  this the same way the M2 spec itself flags its own deviations from the M1 spec.
- **Route ordering:** `/donations/mine` is declared before any parameterized donation
  route, the same Express-5 literal-vs-param rule from every prior plan.
- **Design tokens:** `#FF6B00`/`#C44E00` brand orange, Lora (headings) + Public Sans
  (body), 14px card radius, `Box sx={{ display: 'grid' }}` rather than MUI `<Grid>`.
- Numeric form fields use `z.coerce.number()`; optional string fields that a form
  might submit as `''` use `z.preprocess((v) => (v === '' ? undefined : v), ...)` —
  `.optional()` alone only skips `undefined`.
- Test isolation: `clearDatabase()` + `syncIndexes()` in `beforeEach`.

---

### Task 1: Shared donor and donation schemas

**Files:**
- Create: `shared/src/schemas/donor.schema.js`
- Create: `shared/src/schemas/donor.schema.test.js`
- Create: `shared/src/schemas/donation.schema.js`
- Create: `shared/src/schemas/donation.schema.test.js`
- Modify: `shared/src/index.js`

**Interfaces:**
- Consumes: `objectId` (zod schema for a 24-hex-char id) from `./camp.schema.js`.
- Produces: `DONOR_TYPES`, `DONATION_TYPES`, `DONATION_STATUSES` (arrays) —
  `upsertDonorProfileSchema`, `createDonationSchema`, `donationDecisionSchema`,
  `listDonationsQuerySchema` (zod schemas).

- [ ] **Step 1: Write the failing donor schema test**

```js
// shared/src/schemas/donor.schema.test.js
import { describe, it, expect } from 'vitest';
import { upsertDonorProfileSchema, DONOR_TYPES } from './donor.schema.js';

const validIndividual = {
  donor_type: 'individual', name: 'Meera Iyer', mobile: '9876543210', address: '4 Lake View Road',
};
const validNgo = {
  donor_type: 'ngo', name: 'Riverside Relief Trust', contact_person: 'Arjun Nair',
  mobile: '9876543210', address: 'Registered Office, MG Road', registration_details: 'Reg. No. TN/2019/04521',
};

describe('upsertDonorProfileSchema', () => {
  it('names both §6.12 donor types', () => {
    expect(DONOR_TYPES).toEqual(['individual', 'ngo']);
  });

  it('accepts a well-formed individual donor', () => {
    expect(upsertDonorProfileSchema.safeParse(validIndividual).success).toBe(true);
  });

  it('accepts a well-formed NGO donor', () => {
    expect(upsertDonorProfileSchema.safeParse(validNgo).success).toBe(true);
  });

  it('requires a contact person for an NGO', () => {
    const { contact_person, ...rest } = validNgo;
    const result = upsertDonorProfileSchema.safeParse(rest);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path[0] === 'contact_person')).toBe(true);
  });

  it('requires registration details for an NGO', () => {
    const { registration_details, ...rest } = validNgo;
    const result = upsertDonorProfileSchema.safeParse(rest);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path[0] === 'registration_details')).toBe(true);
  });

  it('does not require a contact person or registration details for an individual', () => {
    expect(upsertDonorProfileSchema.safeParse(validIndividual).success).toBe(true);
  });

  it('rejects an invalid mobile number', () => {
    const result = upsertDonorProfileSchema.safeParse({ ...validIndividual, mobile: '12345' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test --workspace shared -- src/schemas/donor.schema.test.js`
Expected: FAIL — `donor.schema.js` does not exist yet.

- [ ] **Step 3: Write the donor schema**

```js
// shared/src/schemas/donor.schema.js
import { z } from 'zod';

/**
 * Requirements §6.12 Donor / NGO Management. Both donor types share one
 * profile shape rather than two schemas, because most fields (mobile,
 * email, address) are common and an individual/NGO toggle is simpler for a
 * form to drive than two entirely separate submission paths.
 */
export const DONOR_TYPES = ['individual', 'ngo'];

// Same Indian-mobile convention as registration.schema.js and auth.schema.js:
// optional +91/0 prefix, then 10 digits starting 6-9.
const mobileRegex = /^(?:\+91|0)?[6-9]\d{9}$/;

export const upsertDonorProfileSchema = z.object({
  donor_type: z.enum(DONOR_TYPES, { message: 'Choose individual or NGO.' }),
  name: z.string().trim().min(1, 'Name is required.').max(150),
  contact_person: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(150).optional(),
  ),
  mobile: z.string().trim().regex(mobileRegex, 'Enter a valid 10-digit mobile number.'),
  email: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().email('Enter a valid email address.').optional(),
  ),
  address: z.string().trim().min(1, 'Address is required.').max(300),
  registration_details: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(300).optional(),
  ),
}).superRefine((val, ctx) => {
  if (val.donor_type === 'ngo') {
    if (!val.contact_person) {
      ctx.addIssue({ code: 'custom', path: ['contact_person'], message: 'Contact person is required for an NGO.' });
    }
    if (!val.registration_details) {
      ctx.addIssue({ code: 'custom', path: ['registration_details'], message: 'Registration details are required for an NGO.' });
    }
  }
});
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run test --workspace shared -- src/schemas/donor.schema.test.js`
Expected: PASS — all 7 tests.

- [ ] **Step 5: Write the failing donation schema test**

```js
// shared/src/schemas/donation.schema.test.js
import { describe, it, expect } from 'vitest';
import { createDonationSchema, donationDecisionSchema, DONATION_TYPES } from './donation.schema.js';

const validFinancial = { donation_type: 'financial', amount: 5000, payment_method: 'UPI' };
const validMaterial = {
  donation_type: 'material',
  materials: [{ resource_item_id: '64b64b64b64b64b64b64b64b', quantity: 100, unit: 'kg' }],
};

describe('createDonationSchema', () => {
  it('names both §6.13 donation types', () => {
    expect(DONATION_TYPES).toEqual(['financial', 'material']);
  });

  it('accepts a well-formed financial donation', () => {
    expect(createDonationSchema.safeParse(validFinancial).success).toBe(true);
  });

  it('accepts a well-formed material donation', () => {
    expect(createDonationSchema.safeParse(validMaterial).success).toBe(true);
  });

  it('requires an amount for a financial donation', () => {
    const { amount, ...rest } = validFinancial;
    expect(createDonationSchema.safeParse(rest).success).toBe(false);
  });

  it('requires a payment method for a financial donation', () => {
    const { payment_method, ...rest } = validFinancial;
    expect(createDonationSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a financial donation carrying material items', () => {
    const result = createDonationSchema.safeParse({ ...validFinancial, materials: validMaterial.materials });
    expect(result.success).toBe(false);
  });

  it('requires at least one item for a material donation', () => {
    const result = createDonationSchema.safeParse({ donation_type: 'material', materials: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a material donation carrying an amount', () => {
    const result = createDonationSchema.safeParse({ ...validMaterial, amount: 500 });
    expect(result.success).toBe(false);
  });

  it('does not require a target camp at creation — that is a confirmation-time rule', () => {
    expect(createDonationSchema.safeParse(validMaterial).success).toBe(true);
  });

  it('rejects a non-positive quantity on a material item', () => {
    const result = createDonationSchema.safeParse({
      donation_type: 'material',
      materials: [{ ...validMaterial.materials[0], quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('donationDecisionSchema', () => {
  it('accepts confirming with no reason', () => {
    expect(donationDecisionSchema.safeParse({ action: 'confirm' }).success).toBe(true);
  });

  it('requires a reason to reject', () => {
    const result = donationDecisionSchema.safeParse({ action: 'reject' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['rejection_reason']);
  });

  it('accepts rejecting with a reason', () => {
    const result = donationDecisionSchema.safeParse({ action: 'reject', rejection_reason: 'Duplicate entry.' });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npm run test --workspace shared -- src/schemas/donation.schema.test.js`
Expected: FAIL — `donation.schema.js` does not exist yet.

- [ ] **Step 7: Write the donation schema**

```js
// shared/src/schemas/donation.schema.js
import { z } from 'zod';
import { objectId } from './camp.schema.js';

/**
 * Requirements §6.13 Donation Management. A single schema for both types
 * rather than two, discriminated by `donation_type` inside superRefine,
 * because a form toggling between them needs one shape to submit against.
 *
 * `target_camp_id` is optional here even for a material donation — §4.2 of
 * the M2 design makes that a *confirmation-time* rule ("stock has to land
 * somewhere"), not a creation-time one. A donor may record a donation
 * before a camp has been decided.
 */
export const DONATION_TYPES = ['financial', 'material'];
export const DONATION_STATUSES = ['pending', 'confirmed', 'rejected'];

const donationMaterialItemSchema = z.object({
  resource_item_id: objectId,
  quantity: z.coerce.number().positive('Quantity must be greater than zero.'),
  unit: z.string().trim().min(1, 'Unit is required (e.g. kg, liters, pieces).').max(30),
  estimated_value: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().nonnegative('Value cannot be negative.').optional(),
  ),
  remarks: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(300).optional(),
  ),
});

export const createDonationSchema = z.object({
  donation_type: z.enum(DONATION_TYPES, { message: 'Choose a donation type.' }),
  // Set by an admin recording on a donor's behalf; a donor's own submission
  // ignores this and is resolved server-side from their account.
  donor_id: z.preprocess((v) => (v === '' ? undefined : v), objectId.optional()),
  target_camp_id: z.preprocess((v) => (v === '' ? undefined : v), objectId.optional()),
  purpose: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(300).optional(),
  ),
  amount: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().positive('Enter the donated amount.').optional(),
  ),
  payment_method: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(60).optional(),
  ),
  payment_reference: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(120).optional(),
  ),
  materials: z.array(donationMaterialItemSchema).optional(),
}).superRefine((val, ctx) => {
  if (val.donation_type === 'financial') {
    if (!val.amount) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Enter the donated amount.' });
    if (!val.payment_method) ctx.addIssue({ code: 'custom', path: ['payment_method'], message: 'Say how this was paid.' });
    if (val.materials?.length) {
      ctx.addIssue({ code: 'custom', path: ['materials'], message: 'A financial donation does not carry material items.' });
    }
  } else {
    if (!val.materials || val.materials.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['materials'], message: 'Add at least one item.' });
    }
    if (val.amount) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'A material donation does not carry an amount.' });
    }
  }
});

/**
 * A closing decision on a pending donation. Rejection requires a reason —
 * the same rule complaints and SOS apply to their own closing statuses.
 */
export const donationDecisionSchema = z.object({
  action: z.enum(['confirm', 'reject'], { message: 'Choose confirm or reject.' }),
  rejection_reason: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(500).optional(),
  ),
}).superRefine((val, ctx) => {
  if (val.action === 'reject' && !val.rejection_reason) {
    ctx.addIssue({ code: 'custom', path: ['rejection_reason'], message: 'Say why this donation is being rejected.' });
  }
});

export const listDonationsQuerySchema = z.object({
  status: z.preprocess((v) => (v === '' ? undefined : v), z.enum(DONATION_STATUSES).optional()),
  donation_type: z.preprocess((v) => (v === '' ? undefined : v), z.enum(DONATION_TYPES).optional()),
});
```

- [ ] **Step 8: Run both schema test files and confirm they pass**

Run: `npm run test --workspace shared -- src/schemas/donor.schema.test.js src/schemas/donation.schema.test.js`
Expected: PASS — 7 + 13 = 20 tests.

- [ ] **Step 9: Run the full shared suite**

Run: `npm run test --workspace shared`
Expected: PASS across every file, plus the one documented pre-existing `camp.schema`
facilities-default failure (unrelated, unchanged since M1).

- [ ] **Step 10: Export from the shared package and commit**

```js
// shared/src/index.js — append
export * from './schemas/donor.schema.js';
export * from './schemas/donation.schema.js';
```

```bash
git add shared/src/schemas/donor.schema.js shared/src/schemas/donor.schema.test.js \
        shared/src/schemas/donation.schema.js shared/src/schemas/donation.schema.test.js \
        shared/src/index.js
git commit -m "feat(shared): add donor and donation schemas"
```

---

### Task 2: `nextDonationCode`

**Files:**
- Modify: `server/src/core/idGenerator.js`
- Modify: `server/src/core/idGenerator.test.js`

**Interfaces:**
- Consumes: the existing private `nextCode(counterKey, prefix, session)` (Plan 1's
  generalization — no further refactor needed, this is the third caller it was built
  for).
- Produces: `nextDonationCode(session?): Promise<'DON-1001'-shaped string>`.

- [ ] **Step 1: Write the failing test**

```js
// server/src/core/idGenerator.test.js — add below the existing describe blocks
import { nextDonationCode } from './idGenerator.js';

describe('nextDonationCode', () => {
  beforeEach(async () => { await clearDatabase(); });

  it('starts at DON-1001', async () => {
    expect(await nextDonationCode()).toBe('DON-1001');
  });

  it('increments independently of the other counters', async () => {
    await nextBeneficiaryCode();
    await nextSosCode();
    expect(await nextDonationCode()).toBe('DON-1001');
  });

  it('never issues the same code twice under concurrent calls', async () => {
    const codes = await Promise.all(Array.from({ length: 10 }, () => nextDonationCode()));
    expect(new Set(codes).size).toBe(10);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test --workspace server -- src/core/idGenerator.test.js`
Expected: FAIL — `nextDonationCode` is not exported.

- [ ] **Step 3: Add the export**

```js
// server/src/core/idGenerator.js — add below nextSosCode
/** The "Donation ID" of §6.13. */
export const nextDonationCode = (session) => nextCode('donation_code', 'DON', session);
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run test --workspace server -- src/core/idGenerator.test.js`
Expected: PASS — 9 tests (3 beneficiary + 3 SOS + 3 donation).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/idGenerator.js server/src/core/idGenerator.test.js
git commit -m "feat(server): add nextDonationCode"
```

---

### Task 3: `receiveStock` — the inventory-posting primitive

**Files:**
- Modify: `server/src/modules/resources/resources.service.js`
- Modify: `server/src/modules/resources/inventory.model.js`
- Create: `server/src/modules/resources/resources.service.test.js`

**Interfaces:**
- Consumes: `Inventory` model (already in this file) — `isLowStock` from `@frp/shared`.
- Produces: `receiveStock({camp_id, item_id, quantity, expiry_date?}, {actorId,
  session?}): Promise<Inventory>` — a pure DB write with no side effects (no socket
  emit, no notification), so it is safe to call from inside another module's
  transaction. The caller announces low-stock and emits the socket update *after*
  its own transaction commits — the same discipline `distribution.service.js` already
  applies to `emitInventoryChanged`.

This is the one function outside the `donations` module this plan adds, because
donations must never reach `Inventory` directly (module-ownership rule).

Step 3 below required one adjustment beyond what an initial pass suggests, caught by
Step 4's own concurrency test (worth noting up front so it isn't a surprise mid-task):
a plain `findOneAndUpdate` upsert on `{camp_id, item_id}` is not race-safe under
concurrent first-time receipt — nothing enforces at the database layer that only one
of two simultaneous "no lot yet" reads gets to insert. Fixing this needs a real
uniqueness constraint, and it cannot be a plain unique index on `{camp_id, item_id}`
— `Inventory` already allows more than one manually-created batch per camp/item
(`batch_no`), and constraining that would be a regression to shipped M1 behavior.
The fix, included below: a new `source: 'manual' | 'donation'` field defaulting to
`'manual'`, and a **partial** unique index on `{camp_id, item_id, source}` scoped to
`source: 'donation'` — at most one donation-managed lot per camp/item, enforced by
MongoDB itself, while every existing manual batch keeps exactly its current, untouched
behavior. A concurrent loser gets a duplicate-key error and retries, the same
insert-first-catch-duplicate idiom `distribution.service.js` already uses for its
`ALREADY_DISTRIBUTED` guard.

- [ ] **Step 1: Write the failing test**

```js
// server/src/modules/resources/resources.service.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { receiveStock } from './resources.service.js';
import { Inventory } from './inventory.model.js';
import { User, hashPassword } from '../auth/user.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9600000000 + Math.floor(Math.random() * 99999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active', ...over,
  });
}

describe('receiveStock', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates a new inventory lot when this camp has never held the item', async () => {
    const admin = await makeUser('admin');
    const campId = new mongoose.Types.ObjectId();
    const itemId = new mongoose.Types.ObjectId();

    const inv = await receiveStock({ camp_id: campId, item_id: itemId, quantity: 100 }, { actorId: admin._id });

    expect(inv.remaining_qty).toBe(100);
    expect(inv.reorder_threshold).toBe(0);
    expect(await Inventory.countDocuments({ camp_id: campId, item_id: itemId })).toBe(1);
  });

  it('adds to the existing lot rather than creating a second one', async () => {
    const admin = await makeUser('admin');
    const campId = new mongoose.Types.ObjectId();
    const itemId = new mongoose.Types.ObjectId();

    await receiveStock({ camp_id: campId, item_id: itemId, quantity: 100 }, { actorId: admin._id });
    const second = await receiveStock({ camp_id: campId, item_id: itemId, quantity: 40 }, { actorId: admin._id });

    expect(second.remaining_qty).toBe(140);
    expect(await Inventory.countDocuments({ camp_id: campId, item_id: itemId })).toBe(1);
  });

  it('never issues two lots under concurrent first-time receipt', async () => {
    const admin = await makeUser('admin');
    const campId = new mongoose.Types.ObjectId();
    const itemId = new mongoose.Types.ObjectId();

    await Promise.all(
      Array.from({ length: 5 }, () => receiveStock({ camp_id: campId, item_id: itemId, quantity: 10 }, { actorId: admin._id }))
    );

    expect(await Inventory.countDocuments({ camp_id: campId, item_id: itemId })).toBe(1);
    const inv = await Inventory.findOne({ camp_id: campId, item_id: itemId });
    expect(inv.remaining_qty).toBe(50);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test --workspace server -- src/modules/resources/resources.service.test.js`
Expected: FAIL — `receiveStock` is not exported.

- [ ] **Step 3: Add the `source` field and partial unique index**

```js
// server/src/modules/resources/inventory.model.js — add the field, alongside batch_no
    // Distinguishes the single lot receiveStock manages per camp/item from
    // manually-created batches, which may legitimately number more than
    // one. See the partial unique index below.
    source: { type: String, enum: ['manual', 'donation'], default: 'manual' },
```

```js
// server/src/modules/resources/inventory.model.js — add below the existing
// inventorySchema.index({ camp_id: 1, item_id: 1 }); line
// At most one donation-sourced lot per camp/item -- this is what makes
// receiveStock's upsert race-safe under concurrent first-time receipt
// (resources.service.js). Scoped to source:'donation' only, so it never
// constrains manually-created batches, which may still number more than
// one per camp/item as before.
inventorySchema.index(
  { camp_id: 1, item_id: 1, source: 1 },
  { unique: true, partialFilterExpression: { source: 'donation' } }
);
```

- [ ] **Step 4: Add the function**

```js
// server/src/modules/resources/resources.service.js — add after adjustInventory
/**
 * Post a stock increase for camp_id/item_id, creating the lot if this is
 * the first stock this camp has ever held for that item. The only caller
 * outside this module is a confirmed material donation (spec §4.2) — donors
 * reach Inventory only through this function, never the model.
 *
 * A donation-created lot starts with reorder_threshold 0 (no low-stock
 * alert) until an admin sets a real one via the existing adjust endpoint —
 * a donation has no basis to guess what "low" means for this camp.
 *
 * Marked source:'donation' and matched/inserted against that field
 * specifically: a plain {camp_id, item_id} upsert is not race-safe under
 * concurrent first-time receipt (two calls can both see "no lot yet" and
 * both insert). The partial unique index on inventory.model.js enforces at
 * most one source:'donation' lot per camp/item; a concurrent loser gets a
 * duplicate-key error here and retries, folding its receipt into the
 * winner's lot instead of creating a second one. Manually-created batches
 * are untouched by this — they default to source:'manual' and the index
 * does not apply to them.
 *
 * No side effects here on purpose: this is called from inside another
 * module's transaction, and a socket emit or notification must never fire
 * from work that might still be rolled back. The caller announces
 * low-stock and broadcasts the change after its own transaction commits.
 */
export async function receiveStock({ camp_id, item_id, quantity, expiry_date = null }, { actorId, session } = {}) {
  try {
    return await Inventory.findOneAndUpdate(
      { camp_id, item_id, source: 'donation' },
      {
        $inc: { remaining_qty: quantity },
        $setOnInsert: {
          camp_id, item_id, source: 'donation', distributed_qty: 0, reorder_threshold: 0, expiry_date, created_by: actorId,
        },
      },
      { new: true, upsert: true, session }
    );
  } catch (err) {
    if (err?.code === 11000) {
      return receiveStock({ camp_id, item_id, quantity, expiry_date }, { actorId, session });
    }
    throw err;
  }
}
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `npm run test --workspace server -- src/modules/resources/resources.service.test.js`
Expected: PASS — all 3 tests, including the concurrency test (this is the one that
would fail against a plain, non-partial-indexed upsert — confirm it actually exercises
the race by checking it fails first if Steps 3–4 are skipped).

- [ ] **Step 6: Run the full resources test suite to confirm nothing else changed**

Run: `npm run test --workspace server -- src/modules/resources`
Expected: PASS across `resources.test.js`, `inventory.model.test.js`, and the new
`resources.service.test.js` — the new field's default keeps every existing manual-batch
test passing unchanged.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/resources/resources.service.js server/src/modules/resources/inventory.model.js \
        server/src/modules/resources/resources.service.test.js
git commit -m "feat(server): add receiveStock, the donation-to-inventory primitive"
```

---

### Task 4: Donor, Donation, and DonationMaterial models; donor profile service and routes

**Files:**
- Create: `server/src/modules/donations/donor.model.js`
- Create: `server/src/modules/donations/donation.model.js`
- Create: `server/src/modules/donations/donationMaterial.model.js`
- Create: `server/src/modules/donations/donations.service.js`
- Create: `server/src/modules/donations/donations.controller.js`
- Create: `server/src/modules/donations/donations.routes.js`
- Create: `server/src/modules/donations/donations.test.js`
- Modify: `server/src/app.js`

**Interfaces:**
- Consumes: `authenticate`, `authorize(...roles)`, `validate(schema, source?)`
  middleware — `upsertDonorProfileSchema` from `@frp/shared`.
- Produces: `Donor`, `Donation`, `DonationMaterial` (Mongoose models, each with
  `.toSafeJSON()`) — `upsertMyDonorProfile(input, {actorId}): Promise<Donor>` —
  `getMyDonorProfile(actorId): Promise<Donor|null>` — `donationsRouter` mounted at
  `/api`, endpoints `POST /api/donors/me`, `GET /api/donors/me`. This task only wires
  the donor-profile half of the module; donation endpoints arrive in Task 8, but the
  models for all three collections are declared here since `donation.model.js` and
  `donationMaterial.model.js` are needed by Task 5 immediately after.

- [ ] **Step 1: Write the failing donor-profile tests**

```js
// server/src/modules/donations/donations.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9700000000 + Math.floor(Math.random() * 99999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active', ...over,
  });
}
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

const donorProfileBody = (over = {}) => ({
  donor_type: 'individual', name: 'Meera Iyer', mobile: '9876543210', address: '4 Lake View Road', ...over,
});

describe('donor profile (requirements §6.12)', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('shows no profile before one is created', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).get('/api/donors/me').set(bearer(donor));
    expect(res.status).toBe(200);
    expect(res.body.donor).toBeNull();
  });

  it('lets a donor create their own profile', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).post('/api/donors/me').set(bearer(donor)).send(donorProfileBody());
    expect(res.status).toBe(200);
    expect(res.body.donor.name).toBe('Meera Iyer');
    expect(res.body.donor.donor_type).toBe('individual');
  });

  it('lets a donor update their own profile without creating a second one', async () => {
    const donor = await makeUser('donor');
    await request(app).post('/api/donors/me').set(bearer(donor)).send(donorProfileBody());
    const res = await request(app).post('/api/donors/me').set(bearer(donor)).send(donorProfileBody({ name: 'Meera S. Iyer' }));

    expect(res.status).toBe(200);
    expect(res.body.donor.name).toBe('Meera S. Iyer');

    const mine = await request(app).get('/api/donors/me').set(bearer(donor));
    expect(mine.body.donor.name).toBe('Meera S. Iyer');
  });

  it('requires an NGO to supply a contact person and registration details', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).post('/api/donors/me').set(bearer(donor)).send({
      donor_type: 'ngo', name: 'Riverside Relief Trust', mobile: '9876543210', address: 'MG Road',
    });
    expect(res.status).toBe(400);
  });

  it('refuses an affected person', async () => {
    const person = await makeUser('affected_person');
    const res = await request(app).post('/api/donors/me').set(bearer(person)).send(donorProfileBody());
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test --workspace server -- src/modules/donations/donations.test.js`
Expected: FAIL — the `donations` module does not exist yet.

- [ ] **Step 3: Write the models**

```js
// server/src/modules/donations/donor.model.js
import mongoose from 'mongoose';
import { DONOR_TYPES } from '@frp/shared';

/**
 * Requirements §6.12. A profile keyed by user_id, not a parallel account
 * store — donor signup already goes through the common auth flow (users
 * already carries the `donor` role), so a second account store here would
 * fork authentication. The auth module keeps sole ownership of `users`.
 */
const donorSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    donor_type: { type: String, enum: DONOR_TYPES, required: true },
    name: { type: String, required: true, trim: true },
    contact_person: { type: String, default: '' },
    mobile: { type: String, required: true, trim: true },
    email: { type: String, default: '' },
    address: { type: String, required: true, trim: true },
    registration_details: { type: String, default: '' },
  },
  { timestamps: true, collection: 'donors' }
);

donorSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    user_id: this.user_id.toString(),
    donor_type: this.donor_type,
    name: this.name,
    contact_person: this.contact_person,
    mobile: this.mobile,
    email: this.email,
    address: this.address,
    registration_details: this.registration_details,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Donor = mongoose.model('Donor', donorSchema);
```

```js
// server/src/modules/donations/donation.model.js
import mongoose from 'mongoose';
import { DONATION_TYPES, DONATION_STATUSES } from '@frp/shared';

/**
 * Requirements §6.13. `amount`/`payment_method`/`payment_reference` apply
 * only to financial donations; a material donation's line items live in
 * the sibling `donation_materials` collection (donationMaterial.model.js)
 * because a single donation may carry several items with their own
 * quantity/unit/estimated value.
 */
const donationSchema = new mongoose.Schema(
  {
    donation_code: { type: String, required: true, unique: true },
    donor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Donor', required: true, index: true },
    donation_type: { type: String, enum: DONATION_TYPES, required: true },
    target_camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', default: null },
    purpose: { type: String, default: '' },
    status: { type: String, enum: DONATION_STATUSES, default: 'pending', index: true },
    donated_at: { type: Date, default: Date.now },
    amount: { type: Number, default: null },
    payment_method: { type: String, default: '' },
    payment_reference: { type: String, default: '' },
    // Distinguishes a donor's own submission from one an admin recorded on
    // their behalf (spec's own reasoning for why admins may POST /donations).
    recorded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    confirmed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmed_at: { type: Date, default: null },
    rejection_reason: { type: String, default: '' },
  },
  { timestamps: true, collection: 'donations' }
);

donationSchema.index({ donor_id: 1, createdAt: -1 });
donationSchema.index({ status: 1, createdAt: -1 });

donationSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    donation_code: this.donation_code,
    donor_id: this.donor_id.toString(),
    donation_type: this.donation_type,
    target_camp_id: this.target_camp_id ? this.target_camp_id.toString() : null,
    purpose: this.purpose,
    status: this.status,
    donated_at: this.donated_at,
    amount: this.amount,
    payment_method: this.payment_method,
    payment_reference: this.payment_reference,
    recorded_by: this.recorded_by.toString(),
    confirmed_by: this.confirmed_by ? this.confirmed_by.toString() : null,
    confirmed_at: this.confirmed_at,
    rejection_reason: this.rejection_reason,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Donation = mongoose.model('Donation', donationSchema);
```

```js
// server/src/modules/donations/donationMaterial.model.js
import mongoose from 'mongoose';

/**
 * One item line on a material donation (spec §6.13). item_label/category
 * are copied from the ResourceItem at creation time — display fields a
 * donor never types directly, so donated rice and procured rice are always
 * described the same way.
 */
const donationMaterialSchema = new mongoose.Schema(
  {
    donation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Donation', required: true, index: true },
    resource_item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ResourceItem', required: true },
    item_label: { type: String, required: true },
    category: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    estimated_value: { type: Number, default: 0 },
    remarks: { type: String, default: '' },
  },
  { timestamps: true, collection: 'donation_materials' }
);

donationMaterialSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    donation_id: this.donation_id.toString(),
    resource_item_id: this.resource_item_id.toString(),
    item_label: this.item_label,
    category: this.category,
    quantity: this.quantity,
    unit: this.unit,
    estimated_value: this.estimated_value,
    remarks: this.remarks,
  };
};

export const DonationMaterial = mongoose.model('DonationMaterial', donationMaterialSchema);
```

- [ ] **Step 4: Write the donor-profile half of the service**

```js
// server/src/modules/donations/donations.service.js
import { Donor } from './donor.model.js';

/** Create or update the caller's own donor profile — one profile per account. */
export async function upsertMyDonorProfile(input, { actorId }) {
  return Donor.findOneAndUpdate(
    { user_id: actorId },
    { $set: { ...input, user_id: actorId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

export async function getMyDonorProfile(actorId) {
  return Donor.findOne({ user_id: actorId });
}
```

- [ ] **Step 5: Write the controller and routes**

```js
// server/src/modules/donations/donations.controller.js
import * as donationsService from './donations.service.js';

export async function upsertMyDonorProfileHandler(req, res) {
  const donor = await donationsService.upsertMyDonorProfile(req.body, { actorId: req.user.id });
  res.json({ donor: donor.toSafeJSON() });
}

export async function getMyDonorProfileHandler(req, res) {
  const donor = await donationsService.getMyDonorProfile(req.user.id);
  res.json({ donor: donor ? donor.toSafeJSON() : null });
}
```

```js
// server/src/modules/donations/donations.routes.js
import { Router } from 'express';
import { upsertDonorProfileSchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { upsertMyDonorProfileHandler, getMyDonorProfileHandler } from './donations.controller.js';

export const donationsRouter = Router();

// §6.12: donor/NGO self-signup already happens through the common auth
// flow; this is the profile that sits on top of the `donor` account.
donationsRouter.post('/donors/me', authenticate, authorize('donor'), validate(upsertDonorProfileSchema), upsertMyDonorProfileHandler);
donationsRouter.get('/donors/me', authenticate, authorize('donor'), getMyDonorProfileHandler);
```

- [ ] **Step 6: Mount the router**

```js
// server/src/app.js — add import alongside the other module routers
import { donationsRouter } from './modules/donations/donations.routes.js';
```

```js
// server/src/app.js — add alongside the other app.use('/api', ...) calls
  app.use('/api', donationsRouter);
```

- [ ] **Step 7: Run the test file and confirm it passes**

Run: `npm run test --workspace server -- src/modules/donations/donations.test.js`
Expected: PASS — all 5 tests.

- [ ] **Step 8: Run the full server suite**

Run: `npm run test --workspace server`
Expected: PASS across every module.

- [ ] **Step 9: Commit**

```bash
git add server/src/modules/donations/donor.model.js server/src/modules/donations/donation.model.js \
        server/src/modules/donations/donationMaterial.model.js server/src/modules/donations/donations.service.js \
        server/src/modules/donations/donations.controller.js server/src/modules/donations/donations.routes.js \
        server/src/modules/donations/donations.test.js server/src/app.js
git commit -m "feat(server): add donor, donation, and donation-material models; the donor profile endpoint"
```

---

### Task 5: Donation creation — `raiseDonation`

**Files:**
- Modify: `server/src/modules/donations/donations.service.js`
- Modify: `server/src/modules/donations/donations.test.js`

**Interfaces:**
- Consumes: `withTransaction` from `../../core/transaction.js` — `nextDonationCode`
  from `../../core/idGenerator.js` — `recordAudit` from `../audit/audit.service.js`
  — `createNotification` from `../notifications/notifications.service.js` —
  `getCampById` from `../camps/camps.service.js` — `ResourceItem` (read-only) from
  `../resources/resourceItem.model.js` — `User` from `../auth/user.model.js`.
- Produces: `raiseDonation({donation_type, donor_id?, target_camp_id?, purpose?,
  amount?, payment_method?, payment_reference?, materials?}, {actorId, actorRole,
  ip}): Promise<{donation: Donation, materials: DonationMaterial[], donor: Donor}>`.

- [ ] **Step 1: Write the failing tests**

```js
// server/src/modules/donations/donations.test.js — add below the existing describe block
import { Notification } from '../notifications/notification.model.js';
import { ResourceItem } from '../resources/resourceItem.model.js';

const campBody = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7, flood_severity: 'high',
  beneficiary_capacity: 10, volunteer_capacity: 5, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

async function makeDonor(over = {}) {
  const user = await makeUser('donor');
  await request(app).post('/api/donors/me').set(bearer(user)).send(donorProfileBody(over));
  return user;
}

describe('raising a donation (requirements §6.13)', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets a donor record a financial donation and issues a DON- code', async () => {
    const donor = await makeDonor();
    const res = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 5000, payment_method: 'UPI', payment_reference: 'txn_9182',
    });
    expect(res.status).toBe(201);
    expect(res.body.donation.donation_code).toMatch(/^DON-\d+$/);
    expect(res.body.donation.status).toBe('pending');
    expect(res.body.donation.amount).toBe(5000);
  });

  it('lets a donor record a material donation and copies the item label from the catalogue', async () => {
    const admin = await makeUser('admin');
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const donor = await makeDonor();

    const res = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material',
      materials: [{ resource_item_id: itemRes.body.item.id, quantity: 100, unit: 'kg' }],
    });

    expect(res.status).toBe(201);
    expect(res.body.donation.materials).toHaveLength(1);
    expect(res.body.donation.materials[0].item_label).toBe('Rice');
    expect(res.body.donation.materials[0].category).toBe('food');
  });

  it('refuses a donation from a donor with no profile yet', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });
    expect(res.status).toBe(400);
  });

  it('lets an admin record a donation on an existing donor\'s behalf', async () => {
    const donor = await makeDonor();
    const donorRes = await request(app).get('/api/donors/me').set(bearer(donor));
    const admin = await makeUser('admin');

    const res = await request(app).post('/api/donations').set(bearer(admin)).send({
      donation_type: 'financial', donor_id: donorRes.body.donor.id, amount: 2000, payment_method: 'cheque',
    });

    expect(res.status).toBe(201);
    expect(res.body.donation.donor_id).toBe(donorRes.body.donor.id);
    expect(res.body.donation.recorded_by).not.toBe(donorRes.body.donor.user_id);
  });

  it('rejects an admin recording a donation with no donor_id', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).post('/api/donations').set(bearer(admin)).send({
      donation_type: 'financial', amount: 2000, payment_method: 'cheque',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a material donation naming an item that does not exist', async () => {
    const donor = await makeDonor();
    const res = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material',
      materials: [{ resource_item_id: '64b64b64b64b64b64b64b64b', quantity: 10, unit: 'kg' }],
    });
    expect(res.status).toBe(400);
  });

  it('notifies every admin when a donation is recorded', async () => {
    const adminA = await makeUser('admin');
    const adminB = await makeUser('admin');
    const donor = await makeDonor();

    await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });

    expect(await Notification.countDocuments({ user_id: adminA._id, type: 'donation' })).toBe(1);
    expect(await Notification.countDocuments({ user_id: adminB._id, type: 'donation' })).toBe(1);
  });

  it('refuses a camp official', async () => {
    const official = await makeUser('camp_official');
    const res = await request(app).post('/api/donations').set(bearer(official)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test --workspace server -- src/modules/donations/donations.test.js`
Expected: FAIL — `POST /api/donations` is not mounted yet, and `raiseDonation` does
not exist.

- [ ] **Step 3: Extend the notification type enum**

```js
// server/src/modules/notifications/notification.model.js — modify the enum line
      enum: ['low_stock', 'expiry', 'complaint', 'complaint_update', 'sos', 'sos_update', 'donation', 'donation_update', 'other'],
```

- [ ] **Step 4: Write `raiseDonation`**

```js
// server/src/modules/donations/donations.service.js — add these imports at the top
import { Donation } from './donation.model.js';
import { DonationMaterial } from './donationMaterial.model.js';
import { ResourceItem } from '../resources/resourceItem.model.js';
import { User } from '../auth/user.model.js';
import { AppError } from '../../core/errors.js';
import { withTransaction } from '../../core/transaction.js';
import { nextDonationCode } from '../../core/idGenerator.js';
import { recordAudit } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';
import { getCampById } from '../camps/camps.service.js';
```

```js
// server/src/modules/donations/donations.service.js — append
/**
 * §7 of the M2 design: an admin may record a donation on a donor's behalf
 * (a cheque phoned in, say), supplying donor_id. A donor's own submission
 * ignores any donor_id in the body and is always resolved from their own
 * account — nobody may donate as somebody else.
 */
async function resolveDonor(input, { actorId, actorRole }) {
  if (actorRole === 'admin') {
    if (!input.donor_id) {
      throw AppError.badRequest(
        'Choose which donor this is for.',
        [{ path: 'donor_id', message: 'Required when an admin records a donation.' }]
      );
    }
    const donor = await Donor.findById(input.donor_id);
    if (!donor) throw AppError.notFound('No donor with that id.');
    return donor;
  }
  const donor = await Donor.findOne({ user_id: actorId });
  if (!donor) throw AppError.badRequest('Create your donor profile before recording a donation.');
  return donor;
}

export async function raiseDonation(input, { actorId, actorRole, ip }) {
  const donor = await resolveDonor(input, { actorId, actorRole });
  if (input.target_camp_id) await getCampById(input.target_camp_id);

  const { donation, materials } = await withTransaction(async (session) => {
    const [donation] = await Donation.create([{
      donation_code: await nextDonationCode(session),
      donor_id: donor._id,
      donation_type: input.donation_type,
      target_camp_id: input.target_camp_id ?? null,
      purpose: input.purpose ?? '',
      amount: input.amount ?? null,
      payment_method: input.payment_method ?? '',
      payment_reference: input.payment_reference ?? '',
      recorded_by: actorId,
    }], { session });

    let materials = [];
    if (input.donation_type === 'material') {
      const lines = [];
      for (const line of input.materials) {
        const item = await ResourceItem.findById(line.resource_item_id).session(session);
        if (!item) {
          throw AppError.badRequest(
            'One of the donated items does not exist.',
            [{ path: 'materials', message: 'Choose a valid item.' }]
          );
        }
        lines.push({
          donation_id: donation._id, resource_item_id: item._id, item_label: item.name, category: item.category,
          quantity: line.quantity, unit: line.unit, estimated_value: line.estimated_value ?? 0, remarks: line.remarks ?? '',
        });
      }
      materials = await DonationMaterial.create(lines, { session });
    }

    await recordAudit({
      actor_id: actorId, actor_role: actorRole, action: 'donation.create',
      module: 'donations', record_id: donation._id,
      after: { donation_code: donation.donation_code, donation_type: donation.donation_type }, ip, session,
    });

    return { donation, materials };
  });

  await notifyAdminsOfNewDonation(donation, donor);

  return { donation, materials, donor };
}

async function notifyAdminsOfNewDonation(donation, donor) {
  const admins = await User.find({ role: 'admin', status: 'active' });
  const label = donation.donation_type === 'financial' ? `₹${donation.amount}` : 'a material donation';
  const message = `${donation.donation_code}: ${donor.name} recorded ${label}, awaiting confirmation.`;
  await Promise.all(admins.map((a) => createNotification({ user_id: a._id, type: 'donation', ref_id: donation._id, message })));
}
```

- [ ] **Step 5: Write the controller handler and route**

```js
// server/src/modules/donations/donations.controller.js — add this helper at the top
/** Shapes a {donation, materials, donor?} result into the flat JSON the client reads. */
function toDonationJSON({ donation, materials = [], donor = null }) {
  return {
    ...donation.toSafeJSON(),
    materials: materials.map((m) => m.toSafeJSON()),
    donor_name: donor ? donor.name : null,
    donor_type: donor ? donor.donor_type : null,
  };
}
```

```js
// server/src/modules/donations/donations.controller.js — append
export async function raiseDonationHandler(req, res) {
  const result = await donationsService.raiseDonation(req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.status(201).json({ donation: toDonationJSON(result) });
}
```

```js
// server/src/modules/donations/donations.routes.js — add imports
import { createDonationSchema } from '@frp/shared';
import { raiseDonationHandler } from './donations.controller.js';
```

```js
// server/src/modules/donations/donations.routes.js — append
// §6.13: a donor records their own; an admin may record one on an existing
// donor's behalf (a cheque phoned in), never a walk-in with no account.
donationsRouter.post('/donations', authenticate, authorize('admin', 'donor'), validate(createDonationSchema), raiseDonationHandler);
```

- [ ] **Step 6: Run the test file and confirm it passes**

Run: `npm run test --workspace server -- src/modules/donations/donations.test.js`
Expected: PASS — all 13 tests (5 from Task 4, 8 new).

- [ ] **Step 7: Run the full server suite**

Run: `npm run test --workspace server`
Expected: PASS across every module.

- [ ] **Step 8: Commit**

```bash
git add server/src/modules/donations/donations.service.js server/src/modules/donations/donations.controller.js \
        server/src/modules/donations/donations.routes.js server/src/modules/donations/donations.test.js \
        server/src/modules/notifications/notification.model.js
git commit -m "feat(server): record financial and material donations"
```

---

### Task 6: Donation confirmation and rejection — `decideDonation`

**Files:**
- Modify: `server/src/modules/donations/donations.service.js`
- Modify: `server/src/modules/donations/donations.controller.js`
- Modify: `server/src/modules/donations/donations.routes.js`
- Modify: `server/src/modules/donations/donations.test.js`

**Interfaces:**
- Consumes: `receiveStock`, `announceLowStock` from `../resources/resources.service.js`
  — `emitInventoryChanged` from `../../core/socket.js` — `isLowStock` from
  `@frp/shared`.
- Produces: `decideDonation(donationId, {action, rejection_reason?}, {actorId,
  actorRole, ip}): Promise<Donation>`.

This is the invariant-heavy task: §4.1 (only confirmed donations count), §4.2
(material confirmation posts stock, inside the same transaction, target camp
required), and the module-ownership rule all meet here.

- [ ] **Step 1: Write the failing tests**

```js
// server/src/modules/donations/donations.test.js — add below the existing describe block
import { Inventory } from '../resources/inventory.model.js';

describe('deciding a donation (requirements §4.1, §4.2 of the M2 design)', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('confirms a financial donation with no stock side effects', async () => {
    const admin = await makeUser('admin');
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 5000, payment_method: 'UPI',
    });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(admin))
      .send({ action: 'confirm' });

    expect(res.status).toBe(200);
    expect(res.body.donation.status).toBe('confirmed');
    expect(res.body.donation.confirmed_by).toBe(admin._id.toString());
    expect(res.body.donation.confirmed_at).not.toBeNull();
  });

  it('rejects a material donation confirmation with no target camp', async () => {
    const admin = await makeUser('admin');
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material', materials: [{ resource_item_id: itemRes.body.item.id, quantity: 100, unit: 'kg' }],
    });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(admin))
      .send({ action: 'confirm' });

    expect(res.status).toBe(400);
  });

  it('posts stock for every line of a confirmed material donation, into the target camp only', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const otherCampRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody({ name: 'Hilltop School' }));
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material', target_camp_id: campRes.body.camp.id,
      materials: [{ resource_item_id: itemRes.body.item.id, quantity: 100, unit: 'kg' }],
    });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(admin))
      .send({ action: 'confirm' });

    expect(res.status).toBe(200);
    const inv = await Inventory.findOne({ camp_id: campRes.body.camp.id, item_id: itemRes.body.item.id });
    expect(inv.remaining_qty).toBe(100);
    expect(await Inventory.countDocuments({ camp_id: otherCampRes.body.camp.id })).toBe(0);
  });

  // Task 3's receiveStock deviation (see that task's notes above) scopes the
  // "one lot per camp/item" merge to source: 'donation' lots only, so a
  // manually-created batch (POST /api/inventory, source: 'manual') stays a
  // separate document by design -- this test seeds the existing lot via a
  // prior donation confirmation instead, which is what actually exercises
  // receiveStock's merge path.
  it('adds donated stock to an existing donation-sourced lot rather than creating a second one', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const donor = await makeDonor();

    const first = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material', target_camp_id: campRes.body.camp.id,
      materials: [{ resource_item_id: itemRes.body.item.id, quantity: 40, unit: 'kg' }],
    });
    await request(app).patch(`/api/donations/${first.body.donation.id}/confirm`).set(bearer(admin)).send({ action: 'confirm' });

    const second = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material', target_camp_id: campRes.body.camp.id,
      materials: [{ resource_item_id: itemRes.body.item.id, quantity: 100, unit: 'kg' }],
    });
    await request(app).patch(`/api/donations/${second.body.donation.id}/confirm`).set(bearer(admin)).send({ action: 'confirm' });

    expect(await Inventory.countDocuments({ camp_id: campRes.body.camp.id, item_id: itemRes.body.item.id })).toBe(1);
    const inv = await Inventory.findOne({ camp_id: campRes.body.camp.id, item_id: itemRes.body.item.id });
    expect(inv.remaining_qty).toBe(140);
  });

  it('rejects with a reason and never touches stock', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material', target_camp_id: campRes.body.camp.id,
      materials: [{ resource_item_id: itemRes.body.item.id, quantity: 100, unit: 'kg' }],
    });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(admin))
      .send({ action: 'reject', rejection_reason: 'Item mismatch with what was actually delivered.' });

    expect(res.status).toBe(200);
    expect(res.body.donation.status).toBe('rejected');
    expect(await Inventory.countDocuments({ camp_id: campRes.body.camp.id })).toBe(0);
  });

  it('rejects a reject with no reason', async () => {
    const admin = await makeUser('admin');
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(admin))
      .send({ action: 'reject' });
    expect(res.status).toBe(400);
  });

  it('refuses to decide an already-decided donation twice', async () => {
    const admin = await makeUser('admin');
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });
    await request(app).patch(`/api/donations/${created.body.donation.id}/confirm`).set(bearer(admin)).send({ action: 'confirm' });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(admin))
      .send({ action: 'confirm' });
    expect(res.status).toBe(409);
  });

  it('notifies the donor of the decision', async () => {
    const admin = await makeUser('admin');
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });

    await request(app).patch(`/api/donations/${created.body.donation.id}/confirm`).set(bearer(admin)).send({ action: 'confirm' });

    expect(await Notification.countDocuments({ user_id: donor._id, type: 'donation_update' })).toBe(1);
  });

  it('refuses a camp official', async () => {
    const admin = await makeUser('admin');
    const official = await makeUser('camp_official');
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(official))
      .send({ action: 'confirm' });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test --workspace server -- src/modules/donations/donations.test.js`
Expected: FAIL — the confirm route is not mounted yet.

- [ ] **Step 3: Write `decideDonation`**

```js
// server/src/modules/donations/donations.service.js — add these imports at the top
import { receiveStock, announceLowStock } from '../resources/resources.service.js';
import { emitInventoryChanged } from '../../core/socket.js';
import { isLowStock } from '@frp/shared';
```

```js
// server/src/modules/donations/donations.service.js — append
async function loadPendingDonation(donationId, session) {
  const donation = session ? await Donation.findById(donationId).session(session) : await Donation.findById(donationId);
  if (!donation) throw AppError.notFound('No donation with that id.');
  if (donation.status !== 'pending') {
    throw AppError.conflict('ALREADY_DECIDED', 'This donation has already been decided.');
  }
  return donation;
}

async function notifyDonorOfDecision(donation) {
  const donor = await Donor.findById(donation.donor_id);
  if (!donor) return;
  const message = donation.status === 'confirmed'
    ? `${donation.donation_code} has been confirmed. Thank you.`
    : `${donation.donation_code} was not accepted: ${donation.rejection_reason}`;
  await createNotification({ user_id: donor.user_id, type: 'donation_update', ref_id: donation._id, message });
}

async function rejectDonation(donationId, rejection_reason, { actorId, actorRole, ip }) {
  const donation = await loadPendingDonation(donationId);
  const before = { status: donation.status };
  donation.status = 'rejected';
  donation.rejection_reason = rejection_reason;
  donation.confirmed_by = actorId;
  donation.confirmed_at = new Date();
  await donation.save();

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'donation.reject',
    module: 'donations', record_id: donation._id, before, after: { status: 'rejected', rejection_reason }, ip,
  });
  await notifyDonorOfDecision(donation);
  return donation;
}

/**
 * Confirmation, spec section 4.1-4.2 of the M2 design: a material donation
 * with no target camp is refused (stock has to land somewhere). Stock
 * posting happens for every line inside the same transaction as the status
 * change, sequentially -- a session must not run concurrent operations.
 * Low-stock announcements and socket emits fire only after commit, the
 * same discipline distribution.service.js applies to a rolled-back attempt.
 */
async function confirmDonation(donationId, { actorId, actorRole, ip }) {
  const { donation, updatedLots } = await withTransaction(async (session) => {
    const donation = await loadPendingDonation(donationId, session);

    const updatedLots = [];
    if (donation.donation_type === 'material') {
      if (!donation.target_camp_id) {
        throw AppError.badRequest(
          'A material donation needs a target camp before it can be confirmed.',
          [{ path: 'target_camp_id', message: 'Choose which camp receives this.' }]
        );
      }
      const lines = await DonationMaterial.find({ donation_id: donation._id }).session(session);
      for (const line of lines) {
        const inv = await receiveStock(
          { camp_id: donation.target_camp_id, item_id: line.resource_item_id, quantity: line.quantity },
          { actorId, session }
        );
        updatedLots.push(inv);
      }
    }

    const before = { status: donation.status };
    donation.status = 'confirmed';
    donation.confirmed_by = actorId;
    donation.confirmed_at = new Date();
    await donation.save({ session });

    await recordAudit({
      actor_id: actorId, actor_role: actorRole, action: 'donation.confirm',
      module: 'donations', record_id: donation._id, before, after: { status: 'confirmed' }, ip, session,
    });

    return { donation, updatedLots };
  });

  updatedLots.forEach((inv) => {
    emitInventoryChanged(inv.camp_id, { itemId: String(inv.item_id), remaining_qty: inv.remaining_qty });
  });
  for (const inv of updatedLots) {
    if (isLowStock(inv)) await announceLowStock(inv);
  }

  await notifyDonorOfDecision(donation);
  return donation;
}

export async function decideDonation(donationId, { action, rejection_reason }, { actorId, actorRole, ip }) {
  return action === 'reject'
    ? rejectDonation(donationId, rejection_reason, { actorId, actorRole, ip })
    : confirmDonation(donationId, { actorId, actorRole, ip });
}
```

- [ ] **Step 4: Write the controller handler and route**

```js
// server/src/modules/donations/donations.controller.js — append
export async function decideDonationHandler(req, res) {
  const donation = await donationsService.decideDonation(req.params.id, req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.json({ donation: donation.toSafeJSON() });
}
```

```js
// server/src/modules/donations/donations.routes.js — add import
import { donationDecisionSchema } from '@frp/shared';
import { decideDonationHandler } from './donations.controller.js';
```

```js
// server/src/modules/donations/donations.routes.js — append
donationsRouter.patch(
  '/donations/:id/confirm',
  authenticate,
  authorize('admin'),
  validate(donationDecisionSchema),
  decideDonationHandler
);
```

- [ ] **Step 5: Run the test file and confirm it passes**

Run: `npm run test --workspace server -- src/modules/donations/donations.test.js`
Expected: PASS — all 22 tests (13 from Task 5, 9 new).

- [ ] **Step 6: Run the full server suite**

Run: `npm run test --workspace server`
Expected: PASS across every module.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/donations/donations.service.js server/src/modules/donations/donations.controller.js \
        server/src/modules/donations/donations.routes.js server/src/modules/donations/donations.test.js
git commit -m "feat(server): confirm and reject donations, posting stock through receiveStock"
```

---

### Task 7: Donation listing — `listMyDonations` and `listDonations`

**Files:**
- Modify: `server/src/modules/donations/donations.service.js`
- Modify: `server/src/modules/donations/donations.controller.js`
- Modify: `server/src/modules/donations/donations.routes.js`
- Modify: `server/src/modules/donations/donations.test.js`

**Interfaces:**
- Produces: `listMyDonations(actorId): Promise<Array<{donation, materials, donor}>>`
  — `listDonations({status?, donation_type?}): Promise<Array<{donation, materials,
  donor}>>` — both routed at `GET /api/donations/mine` (donor) and `GET
  /api/donations` (admin).

- [ ] **Step 1: Write the failing tests**

```js
// server/src/modules/donations/donations.test.js — add below the existing describe block
describe('listing donations', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('shows a donor only their own donations, materials included', async () => {
    const admin = await makeUser('admin');
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const donorA = await makeDonor({ name: 'Meera Iyer' });
    const donorB = await makeDonor({ name: 'Arjun Nair' });

    await request(app).post('/api/donations').set(bearer(donorA)).send({
      donation_type: 'material', materials: [{ resource_item_id: itemRes.body.item.id, quantity: 50, unit: 'kg' }],
    });
    await request(app).post('/api/donations').set(bearer(donorB)).send({ donation_type: 'financial', amount: 1000, payment_method: 'cash' });

    const res = await request(app).get('/api/donations/mine').set(bearer(donorA));
    expect(res.status).toBe(200);
    expect(res.body.donations).toHaveLength(1);
    expect(res.body.donations[0].materials).toHaveLength(1);
    expect(res.body.donations[0].materials[0].item_label).toBe('Rice');
  });

  it('shows an empty list for a donor with no donations yet', async () => {
    const donor = await makeDonor();
    const res = await request(app).get('/api/donations/mine').set(bearer(donor));
    expect(res.body.donations).toEqual([]);
  });

  it('lets an admin list every donation, filterable by status', async () => {
    const admin = await makeUser('admin');
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({ donation_type: 'financial', amount: 1000, payment_method: 'cash' });
    await request(app).patch(`/api/donations/${created.body.donation.id}/confirm`).set(bearer(admin)).send({ action: 'confirm' });
    await request(app).post('/api/donations').set(bearer(donor)).send({ donation_type: 'financial', amount: 500, payment_method: 'cash' });

    const pending = await request(app).get('/api/donations?status=pending').set(bearer(admin));
    expect(pending.body.donations).toHaveLength(1);
    expect(pending.body.donations[0].status).toBe('pending');

    const all = await request(app).get('/api/donations').set(bearer(admin));
    expect(all.body.donations).toHaveLength(2);
  });

  it('shows the admin the donor\'s name on each donation', async () => {
    const admin = await makeUser('admin');
    const donor = await makeDonor({ name: 'Meera Iyer' });
    await request(app).post('/api/donations').set(bearer(donor)).send({ donation_type: 'financial', amount: 1000, payment_method: 'cash' });

    const res = await request(app).get('/api/donations').set(bearer(admin));
    expect(res.body.donations[0].donor_name).toBe('Meera Iyer');
  });

  it('refuses a donor listing every donation', async () => {
    const donor = await makeDonor();
    const res = await request(app).get('/api/donations').set(bearer(donor));
    expect(res.status).toBe(403);
  });

  it('refuses an admin reading /donations/mine', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).get('/api/donations/mine').set(bearer(admin));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test --workspace server -- src/modules/donations/donations.test.js`
Expected: FAIL — neither list route is mounted yet.

- [ ] **Step 3: Write the listing functions**

```js
// server/src/modules/donations/donations.service.js — append
/**
 * Materials and donor identity, joined in application code rather than
 * $lookup: this module owns all three collections directly, so a plain
 * batched find is simpler than an aggregation pipeline for the volumes
 * involved, and keeps every other function in this file reading the same way.
 */
async function enrichDonations(donations) {
  const materialDonationIds = donations.filter((d) => d.donation_type === 'material').map((d) => d._id);
  const donorIds = [...new Set(donations.map((d) => d.donor_id.toString()))];

  const [materials, donors] = await Promise.all([
    materialDonationIds.length ? DonationMaterial.find({ donation_id: { $in: materialDonationIds } }) : [],
    Donor.find({ _id: { $in: donorIds } }),
  ]);

  const materialsByDonation = new Map();
  materials.forEach((m) => {
    const key = m.donation_id.toString();
    if (!materialsByDonation.has(key)) materialsByDonation.set(key, []);
    materialsByDonation.get(key).push(m);
  });
  const donorsById = new Map(donors.map((d) => [d._id.toString(), d]));

  return donations.map((donation) => ({
    donation,
    materials: materialsByDonation.get(donation._id.toString()) ?? [],
    donor: donorsById.get(donation.donor_id.toString()) ?? null,
  }));
}

/** The donor's own history, newest first. */
export async function listMyDonations(actorId) {
  const donor = await Donor.findOne({ user_id: actorId });
  if (!donor) return [];
  const donations = await Donation.find({ donor_id: donor._id }).sort({ createdAt: -1 });
  return enrichDonations(donations);
}

/** The admin's review queue, optionally narrowed by status or type. */
export async function listDonations({ status, donation_type } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (donation_type) filter.donation_type = donation_type;
  const donations = await Donation.find(filter).sort({ createdAt: -1 }).limit(200);
  return enrichDonations(donations);
}
```

- [ ] **Step 4: Write the controller handlers and routes**

```js
// server/src/modules/donations/donations.controller.js — append
export async function listMyDonationsHandler(req, res) {
  const rows = await donationsService.listMyDonations(req.user.id);
  res.json({ donations: rows.map(toDonationJSON) });
}

export async function listDonationsHandler(req, res) {
  const rows = await donationsService.listDonations({
    status: req.validatedQuery?.status,
    donation_type: req.validatedQuery?.donation_type,
  });
  res.json({ donations: rows.map(toDonationJSON) });
}
```

```js
// server/src/modules/donations/donations.routes.js — add import
import { listDonationsQuerySchema } from '@frp/shared';
import { listMyDonationsHandler, listDonationsHandler } from './donations.controller.js';
```

```js
// server/src/modules/donations/donations.routes.js — append
// /mine declared as its own literal segment, the same convention every
// prior "mine" route in this codebase follows.
donationsRouter.get('/donations/mine', authenticate, authorize('donor'), listMyDonationsHandler);
donationsRouter.get(
  '/donations',
  authenticate,
  authorize('admin'),
  validate(listDonationsQuerySchema, 'query'),
  listDonationsHandler
);
```

- [ ] **Step 5: Run the test file and confirm it passes**

Run: `npm run test --workspace server -- src/modules/donations/donations.test.js`
Expected: PASS — all 28 tests (22 from Task 6, 6 new).

- [ ] **Step 6: Run the full server suite**

Run: `npm run test --workspace server`
Expected: PASS across every module.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/donations/donations.service.js server/src/modules/donations/donations.controller.js \
        server/src/modules/donations/donations.routes.js server/src/modules/donations/donations.test.js
git commit -m "feat(server): list a donor's own donations and the admin review queue"
```

---

### Task 8: Cross-role leakage tests and route-ordering check

**Files:**
- Modify: `server/src/modules/donations/donations.test.js`

**Interfaces:**
- Consumes: everything Tasks 4–7 produced. No new production code — this task is
  purely adversarial: the M2 design spec (§9) singles out cross-role leakage as one
  of four areas needing tests that try to fail, not tests that confirm the happy
  path, because Milestone 1 shipped a real camp-scope bug precisely because its
  search tests only ever used an admin.

- [ ] **Step 1: Write the failing (then passing) leakage tests**

```js
// server/src/modules/donations/donations.test.js — add below the existing describe block
describe('cross-role leakage', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('a donor cannot read another donor\'s profile through any donation payload', async () => {
    const admin = await makeUser('admin');
    const donorA = await makeDonor({ name: 'Meera Iyer', mobile: '9876543210' });
    const donorB = await makeDonor({ name: 'Arjun Nair', mobile: '9123456780' });
    await request(app).post('/api/donations').set(bearer(donorA)).send({ donation_type: 'financial', amount: 1000, payment_method: 'cash' });

    const res = await request(app).get('/api/donations/mine').set(bearer(donorB));
    expect(res.body.donations).toEqual([]);
  });

  it('an admin-recorded donation for donor A cannot be listed under donor B\'s account', async () => {
    const admin = await makeUser('admin');
    const donorA = await makeDonor();
    const donorARes = await request(app).get('/api/donors/me').set(bearer(donorA));
    const donorB = await makeDonor();

    await request(app).post('/api/donations').set(bearer(admin)).send({
      donation_type: 'financial', donor_id: donorARes.body.donor.id, amount: 3000, payment_method: 'cheque',
    });

    const res = await request(app).get('/api/donations/mine').set(bearer(donorB));
    expect(res.body.donations).toEqual([]);
  });

  it('a donor cannot decide their own donation', async () => {
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({ donation_type: 'financial', amount: 1000, payment_method: 'cash' });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(donor))
      .send({ action: 'confirm' });
    expect(res.status).toBe(403);
  });

  it('an affected person cannot reach any donation route', async () => {
    const person = await makeUser('affected_person');
    expect((await request(app).post('/api/donations').set(bearer(person)).send({ donation_type: 'financial', amount: 1, payment_method: 'cash' })).status).toBe(403);
    expect((await request(app).get('/api/donations/mine').set(bearer(person))).status).toBe(403);
    expect((await request(app).get('/api/donations').set(bearer(person))).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it and confirm it passes**

Run: `npm run test --workspace server -- src/modules/donations/donations.test.js`
Expected: PASS — all 32 tests. Every one of these should already pass given Tasks
4–7's implementation (`listMyDonations` scopes by the caller's own `Donor` document,
`authorize('admin')` gates `/confirm`) — this task exists to prove that with tests
written from the adversary's perspective, not to add new behavior. If any fails,
that is a real scoping bug to fix before moving on, not a test to loosen.

- [ ] **Step 3: Commit**

```bash
git add server/src/modules/donations/donations.test.js
git commit -m "test(server): adversarial cross-role leakage checks for donations"
```

---

### Task 9: Client — donations API hooks

**Files:**
- Create: `client/src/api/donations.js`
- Create: `client/src/api/donations.test.jsx`

**Interfaces:**
- Consumes: `api` from `./client.js`.
- Produces: `useMyDonorProfile()`, `useSaveDonorProfile()`, `useRaiseDonation()`,
  `useMyDonations()`, `useAdminDonations(params?)`, `useDecideDonation()`.

- [ ] **Step 1: Write the failing hook test**

```jsx
// client/src/api/donations.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMyDonorProfile, useMyDonations, useAdminDonations } from './donations.js';
import { api } from './client.js';

vi.mock('./client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

function wrapper({ children }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('donations api hooks', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('useMyDonorProfile reads from /donors/me', async () => {
    api.get.mockResolvedValue({ data: { donor: { id: 'd1' } } });
    const { result } = renderHook(() => useMyDonorProfile(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ id: 'd1' }));
    expect(api.get).toHaveBeenCalledWith('/donors/me');
  });

  it('useMyDonations reads from /donations/mine', async () => {
    api.get.mockResolvedValue({ data: { donations: [] } });
    renderHook(() => useMyDonations(), { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/donations/mine'));
  });

  it('useAdminDonations reads from /donations with params', async () => {
    api.get.mockResolvedValue({ data: { donations: [] } });
    renderHook(() => useAdminDonations({ status: 'pending' }), { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/donations', { params: { status: 'pending' } }));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test --workspace client -- src/api/donations.test.jsx`
Expected: FAIL — `./donations.js` does not exist yet.

- [ ] **Step 3: Write the hooks**

```js
// client/src/api/donations.js
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useMyDonorProfile() {
  return useQuery({
    queryKey: ['donors', 'me'],
    queryFn: async () => (await api.get('/donors/me')).data.donor,
  });
}

export function useSaveDonorProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/donors/me', payload)).data.donor,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['donors'] }),
  });
}

export function useRaiseDonation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/donations', payload)).data.donation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['donations'] }),
  });
}

/** The donor's own history. */
export function useMyDonations() {
  return useQuery({
    queryKey: ['donations', 'mine'],
    queryFn: async () => (await api.get('/donations/mine')).data.donations,
  });
}

/** The admin's review queue, optionally filtered. */
export function useAdminDonations(params = {}) {
  return useQuery({
    queryKey: ['donations', 'admin', params],
    queryFn: async () => (await api.get('/donations', { params })).data.donations,
  });
}

export function useDecideDonation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => (await api.patch(`/donations/${id}/confirm`, payload)).data.donation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['donations'] }),
  });
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run test --workspace client -- src/api/donations.test.jsx`
Expected: PASS — all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/api/donations.js client/src/api/donations.test.jsx
git commit -m "feat(client): add donations API hooks"
```

---

### Task 10: Client — DonationCard and the donor profile page

**Files:**
- Create: `client/src/features/donations/DonationCard.jsx`
- Create: `client/src/features/donations/DonorProfilePage.jsx`
- Create: `client/src/features/donations/Donations.test.jsx` (this task's portion;
  Tasks 11–12 extend the same file)

**Interfaces:**
- Consumes: `StatusBadge` from `../../components/StatusBadge.jsx` — `useMyDonorProfile`,
  `useSaveDonorProfile` from `../../api/donations.js` — `toFormErrors` from
  `../../api/client.js` — `DONOR_TYPES` from `@frp/shared`.
- Produces: `DonationCard({donation, children})`, `DonationStatus({status})`,
  `STATUS_LABELS` (exported, reused by Task 12) — `DonorProfilePage()`.

- [ ] **Step 1: Write the failing test**

```jsx
// client/src/features/donations/Donations.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DonorProfilePage } from './DonorProfilePage.jsx';
import { api } from '../../api/client.js';

// patch: vi.fn() included from the start, not just get/post -- Task 12's
// DonationReviewPage tests call api.patch.mockResolvedValue directly, and
// without a stub here that hits the real axios method instead.
vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

// Wrapped in MemoryRouter, not just QueryClientProvider: Task 11's
// DonationEntryPage renders a react-router `Link` in its no-profile state,
// and a Link outside a Router throws. Wrapping every page here rather than
// only that one keeps this one helper usable by all three pages in this
// file, the same way DashboardPage.test.jsx already wraps for the same reason.
function renderPage(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

describe('DonorProfilePage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('starts blank when there is no profile yet', async () => {
    api.get.mockResolvedValue({ data: { donor: null } });
    renderPage(<DonorProfilePage />);
    expect(await screen.findByLabelText(/^name$/i)).toHaveValue('');
  });

  it('pre-fills from an existing profile', async () => {
    api.get.mockResolvedValue({ data: { donor: { donor_type: 'individual', name: 'Meera Iyer', mobile: '9876543210', address: '4 Lake View Road', contact_person: '', email: '', registration_details: '' } } });
    renderPage(<DonorProfilePage />);
    expect(await screen.findByLabelText(/^name$/i)).toHaveValue('Meera Iyer');
  });

  it('shows the NGO fields only when NGO is selected', async () => {
    api.get.mockResolvedValue({ data: { donor: null } });
    const user = userEvent.setup();
    renderPage(<DonorProfilePage />);

    expect(screen.queryByLabelText(/contact person/i)).not.toBeInTheDocument();

    await user.click(await screen.findByRole('combobox', { name: /donor type/i }));
    await user.click(await screen.findByRole('option', { name: /ngo/i }));

    expect(await screen.findByLabelText(/contact person/i)).toBeInTheDocument();
  });

  it('saves and confirms', async () => {
    api.get.mockResolvedValue({ data: { donor: null } });
    api.post.mockResolvedValue({ data: { donor: { name: 'Meera Iyer' } } });
    const user = userEvent.setup();
    renderPage(<DonorProfilePage />);

    await user.type(await screen.findByLabelText(/^name$/i), 'Meera Iyer');
    await user.type(screen.getByLabelText(/mobile/i), '9876543210');
    await user.type(screen.getByLabelText(/address/i), '4 Lake View Road');
    await user.click(screen.getByRole('button', { name: /save profile/i }));

    expect(await screen.findByText(/profile saved/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test --workspace client -- src/features/donations/Donations.test.jsx`
Expected: FAIL — `DonorProfilePage.jsx` does not exist yet.

- [ ] **Step 3: Write `DonationCard.jsx`**

```jsx
// client/src/features/donations/DonationCard.jsx
import { Box, Card, CardContent, Typography } from '@mui/material';
import { StatusBadge } from '../../components/StatusBadge.jsx';

const STATUS_TONE = { pending: 'warn', confirmed: 'ok', rejected: 'bad' };
export const STATUS_LABELS = { pending: 'Pending', confirmed: 'Confirmed', rejected: 'Rejected' };

export function DonationStatus({ status }) {
  return <StatusBadge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABELS[status] ?? status}</StatusBadge>;
}

/** One donation, financial or material, as either the donor or the admin sees it. */
export function DonationCard({ donation, children }) {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{donation.donation_code}</Typography>
          <DonationStatus status={donation.status} />
          {donation.donor_name && (
            <Typography variant="body2" color="text.secondary">{donation.donor_name}</Typography>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
            {new Date(donation.createdAt).toLocaleDateString()}
          </Typography>
        </Box>

        {donation.donation_type === 'financial' ? (
          <Typography sx={{ fontWeight: 600, fontSize: 20, mb: 0.5 }}>₹{donation.amount}</Typography>
        ) : (
          <Box sx={{ mb: 0.5 }}>
            {donation.materials.map((m) => (
              <Typography key={m.id} variant="body2">{m.quantity} {m.unit} — {m.item_label}</Typography>
            ))}
          </Box>
        )}
        {donation.purpose && <Typography variant="body2" color="text.secondary">{donation.purpose}</Typography>}

        {donation.status === 'rejected' && donation.rejection_reason && (
          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid #F0E7DE' }}>
            <Typography sx={{ fontWeight: 600, fontSize: 12, mb: 0.25 }}>Why</Typography>
            <Typography variant="body2">{donation.rejection_reason}</Typography>
          </Box>
        )}

        {children}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Write `DonorProfilePage.jsx`**

```jsx
// client/src/features/donations/DonorProfilePage.jsx
import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, MenuItem, TextField, Typography } from '@mui/material';
import { DONOR_TYPES } from '@frp/shared';
import { useMyDonorProfile, useSaveDonorProfile } from '../../api/donations.js';
import { toFormErrors } from '../../api/client.js';

const EMPTY = { donor_type: 'individual', name: '', contact_person: '', mobile: '', email: '', address: '', registration_details: '' };

const TYPE_LABELS = { individual: 'Individual', ngo: 'NGO / Organization' };

/**
 * §6.12: the profile a donor account fills in once, on top of the common
 * auth flow. Donating is blocked until this exists (donations.service.js's
 * resolveDonor requires it), so this is the first screen a new donor sees.
 */
export function DonorProfilePage() {
  const { data: donor, isLoading } = useMyDonorProfile();
  const save = useSaveDonorProfile();
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (donor) setValues({ ...EMPTY, ...donor });
  }, [donor]);

  const isNgo = values.donor_type === 'ngo';
  const change = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await save.mutateAsync(values);
      setSaved(true);
    } catch (err) {
      setError(toFormErrors(err).message);
    }
  }

  if (isLoading) return <Typography color="text.secondary">Loading…</Typography>;

  return (
    <Card sx={{ maxWidth: 560 }}>
      <CardContent>
        <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 0.5 }}>
          Your donor profile
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Needed once before you can record a donation.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {saved && <Alert severity="success" sx={{ mb: 2 }}>Profile saved.</Alert>}

        <Box component="form" onSubmit={onSubmit} noValidate>
          <TextField select label="Donor type" value={values.donor_type} onChange={change('donor_type')}>
            {DONOR_TYPES.map((t) => <MenuItem key={t} value={t}>{TYPE_LABELS[t] ?? t}</MenuItem>)}
          </TextField>

          <TextField label="Name" value={values.name} onChange={change('name')} />

          {isNgo && (
            <TextField label="Contact person" value={values.contact_person} onChange={change('contact_person')} />
          )}

          <TextField label="Mobile" value={values.mobile} onChange={change('mobile')} placeholder="10-digit mobile number" />
          <TextField label="Email" value={values.email} onChange={change('email')} />
          <TextField label="Address" value={values.address} onChange={change('address')} multiline minRows={2} />

          {isNgo && (
            <TextField
              label="Registration details" value={values.registration_details} onChange={change('registration_details')}
              placeholder="Registration number, issuing authority"
            />
          )}

          <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save profile'}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Run the test file and confirm it passes**

Run: `npm run test --workspace client -- src/features/donations/Donations.test.jsx`
Expected: PASS — all 4 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/features/donations/DonationCard.jsx client/src/features/donations/DonorProfilePage.jsx \
        client/src/features/donations/Donations.test.jsx
git commit -m "feat(client): add DonationCard and the donor profile page"
```

---

### Task 11: Client — donation entry and history page

**Files:**
- Create: `client/src/features/donations/DonationEntryPage.jsx`
- Modify: `client/src/features/donations/Donations.test.jsx`

**Interfaces:**
- Consumes: `DonationCard` from `./DonationCard.jsx` — `useRaiseDonation`,
  `useMyDonations`, `useMyDonorProfile` from `../../api/donations.js` — `useCamps`
  from `../../api/camps.js` — `useResourceItems` from `../../api/resources.js` —
  `toFormErrors` from `../../api/client.js` — `DONATION_TYPES` from `@frp/shared`.
- Produces: `DonationEntryPage()`.

- [ ] **Step 1: Write the failing test**

```jsx
// client/src/features/donations/Donations.test.jsx — append
import { DonationEntryPage } from './DonationEntryPage.jsx';

const CAMPS = [{ id: 'c1', name: 'Riverside Hall' }];
const ITEMS = [{ id: 'i1', name: 'Rice', category: 'food', unit: 'kg' }];
const DONOR = { donor_type: 'individual', name: 'Meera Iyer', mobile: '9876543210', address: 'Addr', contact_person: '', email: '', registration_details: '' };

function mockEntryGet({ donor = DONOR, camps = CAMPS, items = ITEMS, mine = [] } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/donors/me') return Promise.resolve({ data: { donor } });
    if (url === '/camps') return Promise.resolve({ data: { camps } });
    if (url === '/resources') return Promise.resolve({ data: { items } });
    if (url === '/donations/mine') return Promise.resolve({ data: { donations: mine } });
    return Promise.resolve({ data: {} });
  });
}

describe('DonationEntryPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('prompts for a profile first when none exists', async () => {
    mockEntryGet({ donor: null });
    renderPage(<DonationEntryPage />);
    expect(await screen.findByText(/create your donor profile/i)).toBeInTheDocument();
  });

  it('records a financial donation and confirms with the code', async () => {
    mockEntryGet();
    api.post.mockResolvedValue({ data: { donation: { donation_code: 'DON-1007' } } });
    const user = userEvent.setup();
    renderPage(<DonationEntryPage />);

    await user.type(await screen.findByLabelText(/amount/i), '5000');
    await user.type(screen.getByLabelText(/how was this paid/i), 'UPI');
    await user.click(screen.getByRole('button', { name: /record donation/i }));

    expect(await screen.findByText(/DON-1007/)).toBeInTheDocument();
  });

  it('switches to material fields and lets an item be added', async () => {
    mockEntryGet();
    const user = userEvent.setup();
    renderPage(<DonationEntryPage />);

    await user.click(await screen.findByRole('combobox', { name: /^type$/i }));
    await user.click(await screen.findByRole('option', { name: /material/i }));

    expect(await screen.findByRole('combobox', { name: /item/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^amount$/i)).not.toBeInTheDocument();
  });

  it('shows the donor their own donation history', async () => {
    mockEntryGet({ mine: [{ id: 'd1', donation_code: 'DON-1001', donation_type: 'financial', amount: 1000, status: 'confirmed', materials: [], createdAt: '2026-08-13T00:00:00.000Z' }] });
    renderPage(<DonationEntryPage />);
    expect(await screen.findByText('DON-1001')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test --workspace client -- src/features/donations/Donations.test.jsx`
Expected: FAIL — `DonationEntryPage.jsx` does not exist yet.

- [ ] **Step 3: Write `DonationEntryPage.jsx`**

```jsx
// client/src/features/donations/DonationEntryPage.jsx
import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { DONATION_TYPES } from '@frp/shared';
import { useRaiseDonation, useMyDonations, useMyDonorProfile } from '../../api/donations.js';
import { useCamps } from '../../api/camps.js';
import { useResourceItems } from '../../api/resources.js';
import { toFormErrors } from '../../api/client.js';
import { DonationCard } from './DonationCard.jsx';

const TYPE_LABELS = { financial: 'Financial', material: 'Material' };

const emptyMaterialRow = () => ({ resource_item_id: '', quantity: '', unit: '', estimated_value: '', remarks: '' });

/**
 * Where a donor records a gift and watches what happened to the last one —
 * the same "raise it, watch it" pattern as complaints and SOS. Blocked
 * behind a profile: donations.service.js's resolveDonor requires one, so a
 * donor who has not filled theirs in yet is sent there instead of hitting
 * a confusing 400 on submit.
 */
export function DonationEntryPage() {
  const { data: donor, isLoading: profileLoading } = useMyDonorProfile();
  const { data: camps = [] } = useCamps();
  const { data: items = [] } = useResourceItems();
  const { data: mine = [], isLoading: historyLoading } = useMyDonations();
  const raise = useRaiseDonation();

  const [donationType, setDonationType] = useState('financial');
  const [targetCampId, setTargetCampId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [materials, setMaterials] = useState([emptyMaterialRow()]);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);

  if (profileLoading) return <Typography color="text.secondary">Loading…</Typography>;

  if (!donor) {
    return (
      <Alert severity="info" sx={{ maxWidth: 560 }}>
        Create your donor profile before recording a donation.{' '}
        <RouterLink to="/donor/profile">Set it up now.</RouterLink>
      </Alert>
    );
  }

  const changeMaterial = (i, field) => (e) => {
    const next = [...materials];
    next[i] = { ...next[i], [field]: e.target.value };
    setMaterials(next);
  };
  const addRow = () => setMaterials((m) => [...m, emptyMaterialRow()]);
  const removeRow = (i) => setMaterials((m) => m.filter((_, idx) => idx !== i));

  const financialValid = donationType === 'financial' && Number(amount) > 0 && paymentMethod.trim().length > 0;
  const materialValid = donationType === 'material' && materials.every((m) => m.resource_item_id && Number(m.quantity) > 0 && m.unit.trim());
  const canSubmit = donationType === 'financial' ? financialValid : materialValid;

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSent(null);
    try {
      const payload = {
        donation_type: donationType,
        target_camp_id: targetCampId || undefined,
        purpose: purpose || undefined,
        ...(donationType === 'financial'
          ? { amount: Number(amount), payment_method: paymentMethod, payment_reference: paymentReference || undefined }
          : {
              materials: materials.map((m) => ({
                resource_item_id: m.resource_item_id, quantity: Number(m.quantity), unit: m.unit,
                estimated_value: m.estimated_value ? Number(m.estimated_value) : undefined,
                remarks: m.remarks || undefined,
              })),
            }),
      };
      const created = await raise.mutateAsync(payload);
      setSent(`Recorded as ${created.donation_code}. An admin will confirm it shortly.`);
      setAmount(''); setPaymentMethod(''); setPaymentReference(''); setPurpose('');
      setMaterials([emptyMaterialRow()]);
    } catch (err) {
      setError(toFormErrors(err).message);
    }
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 4, alignItems: 'start' }}>
      <Card>
        <CardContent>
          <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 0.5 }}>
            Record a donation
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Every donation is confirmed by an admin before it counts.
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {sent && <Alert severity="success" sx={{ mb: 2 }}>{sent}</Alert>}

          <Box component="form" onSubmit={onSubmit} noValidate>
            <TextField select label="Type" value={donationType} onChange={(e) => setDonationType(e.target.value)}>
              {DONATION_TYPES.map((t) => <MenuItem key={t} value={t}>{TYPE_LABELS[t] ?? t}</MenuItem>)}
            </TextField>

            <TextField select label="Target camp (optional)" value={targetCampId} onChange={(e) => setTargetCampId(e.target.value)}>
              <MenuItem value="">General — no specific camp</MenuItem>
              {camps.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>

            <TextField label="Purpose (optional)" value={purpose} onChange={(e) => setPurpose(e.target.value)} />

            {donationType === 'financial' ? (
              <>
                <TextField label="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <TextField label="How was this paid" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="Cash, UPI, cheque, bank transfer…" />
                <TextField label="Payment reference (optional)" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} />
              </>
            ) : (
              <Stack spacing={1.5} sx={{ mt: 1, mb: 2 }}>
                {materials.map((m, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <TextField select label="Item" value={m.resource_item_id} onChange={changeMaterial(i, 'resource_item_id')} sx={{ flex: 2, mb: 0 }}>
                      {items.map((it) => <MenuItem key={it.id} value={it.id}>{it.name}</MenuItem>)}
                    </TextField>
                    <TextField label="Quantity" type="number" value={m.quantity} onChange={changeMaterial(i, 'quantity')} sx={{ flex: 1, mb: 0 }} />
                    <TextField label="Unit" value={m.unit} onChange={changeMaterial(i, 'unit')} sx={{ flex: 1, mb: 0 }} />
                    <IconButton aria-label="Remove item" onClick={() => removeRow(i)} disabled={materials.length === 1} sx={{ mt: 0.5 }}>
                      ✕
                    </IconButton>
                  </Box>
                ))}
                <Button onClick={addRow} size="small" sx={{ alignSelf: 'flex-start' }}>+ Add another item</Button>
              </Stack>
            )}

            <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={raise.isPending || !canSubmit}>
              {raise.isPending ? 'Recording…' : 'Record donation'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Box>
        <Typography sx={{ fontWeight: 600, mb: 1.5 }}>Your donations</Typography>
        <Stack spacing={1.5}>
          {mine.map((d) => <DonationCard key={d.id} donation={d} />)}
          {!historyLoading && mine.length === 0 && (
            <Typography color="text.secondary" variant="body2">You have not recorded a donation yet.</Typography>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npm run test --workspace client -- src/features/donations/Donations.test.jsx`
Expected: PASS — all 8 tests (4 from Task 10, 4 new).

- [ ] **Step 5: Commit**

```bash
git add client/src/features/donations/DonationEntryPage.jsx client/src/features/donations/Donations.test.jsx
git commit -m "feat(client): add the donation entry and history page"
```

---

### Task 12: Client — admin donation review page, routes, and navigation

**Files:**
- Create: `client/src/features/donations/DonationReviewPage.jsx`
- Modify: `client/src/features/donations/Donations.test.jsx`
- Modify: `client/src/App.jsx`
- Modify: `client/src/layouts/RoleLayout.jsx`

**Interfaces:**
- Consumes: `DonationCard`, `STATUS_LABELS` from `./DonationCard.jsx` —
  `useAdminDonations`, `useDecideDonation` from `../../api/donations.js` —
  `DONATION_STATUSES` from `@frp/shared`.
- Produces: `DonationReviewPage()` — routes `/donor/profile`, `/donor/donate`
  (donor), `/admin/donations` (admin); nav entries for both.

- [ ] **Step 1: Write the failing test**

```jsx
// client/src/features/donations/Donations.test.jsx — append
import { DonationReviewPage } from './DonationReviewPage.jsx';

const PENDING = {
  id: 'd1', donation_code: 'DON-1001', donation_type: 'financial', amount: 3000,
  status: 'pending', materials: [], donor_name: 'Meera Iyer', createdAt: '2026-08-13T00:00:00.000Z',
};

describe('DonationReviewPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists what needs review', async () => {
    api.get.mockImplementation((url) => (url === '/donations' ? Promise.resolve({ data: { donations: [PENDING] } }) : Promise.resolve({ data: {} })));
    renderPage(<DonationReviewPage />);
    expect(await screen.findByText('DON-1001')).toBeInTheDocument();
    expect(screen.getByText('Meera Iyer')).toBeInTheDocument();
  });

  it('confirms with one click', async () => {
    api.get.mockImplementation((url) => (url === '/donations' ? Promise.resolve({ data: { donations: [PENDING] } }) : Promise.resolve({ data: {} })));
    api.patch.mockResolvedValue({ data: { donation: { ...PENDING, status: 'confirmed' } } });
    const user = userEvent.setup();
    renderPage(<DonationReviewPage />);

    await user.click(await screen.findByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/donations/d1/confirm', { action: 'confirm' }));
  });

  it('asks for a reason before rejecting', async () => {
    api.get.mockImplementation((url) => (url === '/donations' ? Promise.resolve({ data: { donations: [PENDING] } }) : Promise.resolve({ data: {} })));
    const user = userEvent.setup();
    renderPage(<DonationReviewPage />);

    await user.click(await screen.findByRole('button', { name: /^reject$/i }));
    expect(await screen.findByLabelText(/reason/i)).toBeInTheDocument();
  });

  it('says so when nothing is pending', async () => {
    api.get.mockImplementation((url) => (url === '/donations' ? Promise.resolve({ data: { donations: [] } }) : Promise.resolve({ data: {} })));
    renderPage(<DonationReviewPage />);
    expect(await screen.findByText(/nothing (is )?waiting/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test --workspace client -- src/features/donations/Donations.test.jsx`
Expected: FAIL — `DonationReviewPage.jsx` does not exist yet.

- [ ] **Step 3: Write `DonationReviewPage.jsx`**

```jsx
// client/src/features/donations/DonationReviewPage.jsx
import { useState } from 'react';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { DONATION_STATUSES } from '@frp/shared';
import { useAdminDonations, useDecideDonation } from '../../api/donations.js';
import { toFormErrors } from '../../api/client.js';
import { DonationCard, STATUS_LABELS } from './DonationCard.jsx';

/** The confirm/reject controls an admin gets on a pending donation. */
function DecisionControls({ donation }) {
  const decide = useDecideDonation();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  if (donation.status !== 'pending') return null;

  async function confirm() {
    setError(null);
    try {
      await decide.mutateAsync({ id: donation.id, action: 'confirm' });
    } catch (err) {
      setError(toFormErrors(err).message);
    }
  }

  async function reject() {
    setError(null);
    try {
      await decide.mutateAsync({ id: donation.id, action: 'reject', rejection_reason: reason });
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setError(fields.rejection_reason ?? message);
    }
  }

  return (
    <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #F0E7DE' }}>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!rejecting ? (
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="contained" size="medium" onClick={confirm} disabled={decide.isPending}>Confirm</Button>
          <Button variant="outlined" color="error" size="medium" onClick={() => setRejecting(true)} disabled={decide.isPending}>Reject</Button>
        </Box>
      ) : (
        <Box>
          <TextField
            label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Required before rejecting." multiline minRows={2}
          />
          <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
            <Button variant="contained" color="error" onClick={reject} disabled={decide.isPending}>
              {decide.isPending ? 'Saving…' : 'Confirm rejection'}
            </Button>
            <Button variant="text" onClick={() => setRejecting(false)}>Cancel</Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/** The admin's review queue: every donation, defaulting to what still needs a decision. */
export function DonationReviewPage() {
  const [statusFilter, setStatusFilter] = useState('pending');
  const { data: donations = [], isLoading } = useAdminDonations(statusFilter ? { status: statusFilter } : {});

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>
          Donations
        </Typography>
        <TextField
          select size="small" label="Filter by status" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          sx={{ minWidth: 180, ml: 'auto', mb: 0 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {DONATION_STATUSES.map((s) => <MenuItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</MenuItem>)}
        </TextField>
      </Box>

      <Stack spacing={2} sx={{ maxWidth: 720 }}>
        {donations.map((d) => (
          <DonationCard key={d.id} donation={d}>
            <DecisionControls donation={d} />
          </DonationCard>
        ))}
        {!isLoading && donations.length === 0 && (
          <Typography color="text.secondary">Nothing is waiting on a decision.</Typography>
        )}
      </Stack>
    </Box>
  );
}
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npm run test --workspace client -- src/features/donations/Donations.test.jsx`
Expected: PASS — all 12 tests (8 from Task 11, 4 new).

- [ ] **Step 5: Wire the routes**

```jsx
// client/src/App.jsx — add imports near the other feature imports
import { DonorProfilePage } from './features/donations/DonorProfilePage.jsx';
import { DonationEntryPage } from './features/donations/DonationEntryPage.jsx';
import { DonationReviewPage } from './features/donations/DonationReviewPage.jsx';
```

```jsx
// client/src/App.jsx — the shared RequireAuth block (any authenticated role) already
// covers /donor as the LandingPage; add the two donor-only screens as their own group
              <Route element={<RequireAuth roles={['donor']} />}>
                <Route element={<RoleLayout />}>
                  <Route path="/donor/profile" element={<DonorProfilePage />} />
                  <Route path="/donor/donate" element={<DonationEntryPage />} />
                </Route>
              </Route>
```

```jsx
// client/src/App.jsx — the admin-only route group; add /admin/donations
                  <Route path="/admin/distribution-rules" element={<DistributionRulesPage />} />
                  <Route path="/admin/donations" element={<DonationReviewPage />} />
```

- [ ] **Step 6: Add navigation entries**

```jsx
// client/src/layouts/RoleLayout.jsx — modify NAV_BY_ROLE

// Was: donor had no entry at all ("a donor still has a single screen, so
// links would be noise there"). That is no longer true — a donor now has
// three: browse camps, manage their profile, and record a donation.
```

```jsx
const NAV_BY_ROLE = {
  affected_person: [
    { to: '/', label: 'Camps', end: true },
    { to: '/queries', label: 'My queries' },
    { to: '/sos', label: 'Report emergency' },
  ],
  donor: [
    { to: '/donor', label: 'Camps', end: true },
    { to: '/donor/profile', label: 'My profile' },
    { to: '/donor/donate', label: 'Donate' },
  ],
  admin: [
    { to: '/admin', label: 'Dashboard', end: true },
    { to: '/admin/areas', label: 'Areas' },
    { to: '/admin/camps', label: 'Camps' },
    { to: '/admin/officials', label: 'Officials' },
    { to: '/admin/resources', label: 'Resources' },
    { to: '/admin/inventory', label: 'Inventory' },
    { to: '/admin/distribution-rules', label: 'Rules' },
    { to: '/official/distribute', label: 'Distribute' },
    { to: '/official/queries', label: 'Queries' },
    { to: '/official/sos', label: 'Emergency' },
    { to: '/admin/donations', label: 'Donations' },
  ],
  camp_official: [
    { to: '/official', label: 'Home', end: true },
    { to: '/official/checkin', label: 'Check-in' },
    { to: '/official/distribute', label: 'Distribute' },
    { to: '/official/distributions', label: 'History' },
    { to: '/official/volunteers', label: 'Volunteers' },
    { to: '/official/queries', label: 'Queries' },
    { to: '/official/sos', label: 'Emergency' },
  ],
};
```

Also remove the now-stale comment above `NAV_BY_ROLE` that says only roles with more
than one destination get a nav bar (still true in spirit, but donor is no longer the
example of an excluded role):

```jsx
// client/src/layouts/RoleLayout.jsx — replace the comment directly above NAV_BY_ROLE
// Every role listed here gets a nav bar; a role with a genuinely single
// screen would be omitted, but none currently is.
```

- [ ] **Step 7: Run the full client suite**

Run: `npm run test --workspace client`
Expected: PASS across every file.

- [ ] **Step 8: Commit**

```bash
git add client/src/features/donations/DonationReviewPage.jsx client/src/features/donations/Donations.test.jsx \
        client/src/App.jsx client/src/layouts/RoleLayout.jsx
git commit -m "feat(client): add the admin donation review page; wire routes and navigation"
```

---

### Task 13: Full-stack verification against §16 criterion 17

**Files:**
- Create: `scripts/verify-donations.mjs`
- Create: `docs/superpowers/plans/2026-08-13-m2-plan2-verification.md`

**Interfaces:**
- Consumes: the running dev server (`npm run dev`), `mongoose`, `signAccessToken`
  from `server/src/core/tokens.js` — same shape as `scripts/verify-sos.mjs`.

- [ ] **Step 1: Run the full test suite one more time from the repo root**

Run: `npm test`
Expected: PASS across `shared`, `server`, and `client` — every count from Tasks 1–12
holds simultaneously.

- [ ] **Step 2: Write the live verification script**

```js
// scripts/verify-donations.mjs
/**
 * Dev check against the running server for donors and donations (§6.12,
 * §6.13), proving stock posting and §16 criterion 17 live: "Donors can
 * record fund and material donations and receive a unique Donation ID."
 *
 * Run: node --env-file=.env scripts/verify-donations.mjs
 */
import mongoose from 'mongoose';
import { signAccessToken } from '../server/src/core/tokens.js';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:4000';
await mongoose.connect(process.env.MONGODB_URI);
const users = mongoose.connection.collection('users');
const camps = mongoose.connection.collection('camps');

const admin = await users.findOne({ role: 'admin', status: 'active' });
let donor = await users.findOne({ role: 'donor', status: 'active' });
const camp = await camps.findOne({});

const tokenFor = (u) => signAccessToken({ _id: u._id, role: u.role, status: u.status, assigned_camp_ids: u.assigned_camp_ids ?? [] });
const hdrs = (u) => ({ Authorization: `Bearer ${tokenFor(u)}`, 'Content-Type': 'application/json' });

async function call(label, u, method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: hdrs(u), ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await res.json().catch(() => ({}));
  return { label, status: res.status, json };
}
const show = (r, extra = '') => console.log(`${r.label.padEnd(52)} ${r.status}  ${extra || r.json.error?.message || ''}`);

console.log('--- donor profile (§6.12) ---');
show(await call('donor POST /donors/me', donor, 'POST', '/api/donors/me', {
  donor_type: 'individual', name: 'Verify Donor', mobile: '9876543210', address: 'Live verification address',
}));

console.log('--- resource item for the material donation ---');
const item = await call('admin POST /resources', admin, 'POST', '/api/resources', {
  name: `Verify Rice ${Date.now()}`, category: 'food', unit: 'kg',
});
show(item, item.json.item?.id);

console.log('--- material donation → confirmation → stock (§16 #17, §4.2 of the M2 design) ---');
const before = await call('inventory before', admin, 'GET', `/api/inventory?camp_id=${camp._id}`);
const beforeQty = (before.json.inventory ?? []).find((i) => i.item_id === item.json.item.id)?.remaining_qty ?? 0;

const material = await call('donor POST /donations (material)', donor, 'POST', '/api/donations', {
  donation_type: 'material', target_camp_id: camp._id.toString(),
  materials: [{ resource_item_id: item.json.item.id, quantity: 100, unit: 'kg' }],
});
show(material, material.json.donation?.donation_code);

const confirmed = await call('admin PATCH confirm', admin, 'PATCH', `/api/donations/${material.json.donation.id}/confirm`, { action: 'confirm' });
show(confirmed, confirmed.json.donation?.status);

const after = await call('inventory after', admin, 'GET', `/api/inventory?camp_id=${camp._id}`);
const afterQty = (after.json.inventory ?? []).find((i) => i.item_id === item.json.item.id)?.remaining_qty ?? 0;
console.log(`camp inventory: ${beforeQty} -> ${afterQty} (expect +100)`);

console.log('--- financial donation, rejection, and the derived-totals principle (§16 #20) ---');
const financial = await call('donor POST /donations (financial)', donor, 'POST', '/api/donations', {
  donation_type: 'financial', amount: 2500, payment_method: 'UPI',
});
show(financial, financial.json.donation?.donation_code);
show(await call('admin PATCH reject, no reason', admin, 'PATCH', `/api/donations/${financial.json.donation.id}/confirm`, { action: 'reject' }), 'expect 400');
const rejected = await call('admin PATCH reject, with reason', admin, 'PATCH', `/api/donations/${financial.json.donation.id}/confirm`, {
  action: 'reject', rejection_reason: 'Live verification: intentionally rejected.',
});
show(rejected, rejected.json.donation?.status);

const mine = await call('donor GET /donations/mine', donor, 'GET', '/api/donations/mine');
const totalConfirmed = (mine.json.donations ?? []).filter((d) => d.status === 'confirmed' && d.donation_type === 'financial')
  .reduce((sum, d) => sum + d.amount, 0);
console.log(`donor's own confirmed financial total, computed from the list (never a stored field): ₹${totalConfirmed}`);

console.log('--- role boundaries ---');
const person = await users.findOne({ role: 'affected_person', status: 'active' });
show(await call('affected person POST /donations', person, 'POST', '/api/donations', { donation_type: 'financial', amount: 1, payment_method: 'cash' }));
show(await call('donor GET /donations (admin-only)', donor, 'GET', '/api/donations'));

await mongoose.disconnect();
```

- [ ] **Step 3: Run it against the live dev server**

Start the app (`npm run dev` from the repo root) if it is not already running, then:

Run: `node --env-file=.env scripts/verify-donations.mjs`

If no `donor` account exists yet in the dev database, sign up one through the running
app first (role `donor`) — donors are `active` immediately on signup, unlike
`camp_official`.

Record the actual output. Expected shape:
- The donor profile saves.
- The material donation is created `pending`, then confirmed, and the camp's
  inventory for that item rises by exactly 100.
- The financial donation's reject-with-no-reason attempt is refused with 400; the
  reject-with-reason attempt succeeds.
- The donor's own confirmed-financial total is computed from the list response, not
  read from any stored field.
- The affected person's donation attempt is refused with 403; the donor's attempt to
  list every donation is refused with 403.

- [ ] **Step 4: Write the verification record**

Create `docs/superpowers/plans/2026-08-13-m2-plan2-verification.md` following the
same structure as `docs/superpowers/plans/2026-08-13-m2-plan1-verification.md`: a
table of each check with **PASS**/**FAIL** and the literal output observed, a "Known
gaps" section, and the final test counts from Step 1.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-donations.mjs docs/superpowers/plans/2026-08-13-m2-plan2-verification.md
git commit -m "docs: verify Plan 2 (donors and donations) end-to-end against §16 criterion 17"
```
