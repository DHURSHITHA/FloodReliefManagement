# Relief Ops (Resources, Inventory, Distribution, Volunteer Duties, Admin Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Milestone 1's Relief Ops module (spec slices 8–9): admin configures resource stock and distribution rules per camp, distribution is duplicate-proof and stock-safe under concurrency, volunteers move from "accepted" to an assigned duty to "completed," and the M1 admin dashboard finally surfaces all of it — closing the gap flagged after Plan 3 where `/admin` and `/official` were still placeholders even though their underlying screens existed.

**Architecture:** Two new server modules — `resources/` (owns `resource_items`, `inventory`, `distribution_rules`) and `distribution/` (owns `distribution_records`) — plus a small `notifications/` module for low-stock alerts, and an extension to Plan 3's `intake/` module for volunteer duty assign/complete (module ownership: `intake/` already owns `registration_members`, where `volunteer_status`/`volunteer_task` live). The distribution transaction is spec §5.4's exact sequence: insert the distribution record first (so the duplicate-key check can't race), then deduct stock atomically, all inside one MongoDB transaction. The admin dashboard is a read-only aggregation layer over data every earlier plan already produces — no new business logic, just the shell spec §7.1 always intended M1 to have.

**Tech Stack:** Same as Plans 1–3.

## Global Constraints

- Distribution is one transaction, insert-first: `distribution_records.insert` (catches the duplicate-key conflict) *before* the stock deduction, not after — spec §5.4, verbatim.
- The unique index on `distribution_records` is `{beneficiary_id, item_id, period_key}` — a repeat for the same beneficiary+item within the same period (`'2026-08-12'` daily, `'2026-W33'` weekly, `'once'`) is blocked.
- Stock deduction is guarded exactly like Plan 2's beneficiary-capacity guard: `inventory.findOneAndUpdate({_id, remaining_qty: {$gte: qty}}, {$inc: {remaining_qty: -qty, distributed_qty: qty}})` — `null` means insufficient stock, abort.
- Verification policy (spec §7, §5.4): distribution to a beneficiary with **no** checked-in members is blocked by default; an official can override, but the override requires a recorded `override_reason` and is audited. Never a hard database constraint that could refuse a starving, unverified family outright.
- `calcRation(rule, members)` and `computePeriodKey(period, date)` are pure, unit-tested functions in `shared/` — spec §3.1, §9.
- Every mutation is audited via `recordAudit()`; every dashboard figure is computed by aggregation, never manually entered (spec §18).
- `req.validatedQuery`, not `req.query`, for any query-validated route (the Express 5 bug fixed in Plan 2).
- Socket.IO events `inventory:changed` and `inventory:low_stock` follow the exact no-op-safe pattern of Plan 2's `emitCampOccupancy` — never throw when nothing is listening.

---

### Task 1: Resource and inventory domain logic + models

**Files:**
- Create: `shared/src/inventory.js`
- Create: `shared/src/schemas/resource.schema.js`
- Create: `server/src/modules/resources/resourceItem.model.js`, `server/src/modules/resources/inventory.model.js`
- Modify: `shared/src/index.js`
- Test: `shared/src/inventory.test.js`, `shared/src/schemas/resource.schema.test.js`, `server/src/modules/resources/inventory.model.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `isLowStock({remaining_qty, reorder_threshold}): boolean`, `isNearExpiry(expiry_date, withinDays?, now?): boolean`, `isExpired(expiry_date, now?): boolean`, `createResourceItemSchema`, `createInventorySchema`, `ResourceItem` and `Inventory` Mongoose models with `toSafeJSON()`

- [ ] **Step 1: Write the failing tests for the pure stock-status helpers**

Create `shared/src/inventory.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { isLowStock, isNearExpiry, isExpired } from './inventory.js';

describe('isLowStock', () => {
  it('is true when remaining is at or below the threshold', () => {
    expect(isLowStock({ remaining_qty: 5, reorder_threshold: 5 })).toBe(true);
    expect(isLowStock({ remaining_qty: 4, reorder_threshold: 5 })).toBe(true);
  });

  it('is false above the threshold', () => {
    expect(isLowStock({ remaining_qty: 6, reorder_threshold: 5 })).toBe(false);
  });
});

describe('isNearExpiry', () => {
  const now = new Date('2026-08-12T00:00:00Z');

  it('is true within the default 7-day window', () => {
    expect(isNearExpiry('2026-08-15T00:00:00Z', 7, now)).toBe(true);
  });

  it('is false outside the window', () => {
    expect(isNearExpiry('2026-09-01T00:00:00Z', 7, now)).toBe(false);
  });

  it('is false when there is no expiry date', () => {
    expect(isNearExpiry(null, 7, now)).toBe(false);
  });
});

describe('isExpired', () => {
  const now = new Date('2026-08-12T00:00:00Z');

  it('is true for a past expiry date', () => {
    expect(isExpired('2026-08-01T00:00:00Z', now)).toBe(true);
  });

  it('is false for a future expiry date', () => {
    expect(isExpired('2026-09-01T00:00:00Z', now)).toBe(false);
  });

  it('is false when there is no expiry date', () => {
    expect(isExpired(null, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace shared`
Expected: FAIL — cannot resolve `./inventory.js`.

- [ ] **Step 3: Implement the pure helpers**

Create `shared/src/inventory.js`:

```js
/** Low-stock threshold check — spec section 6.8's low-stock alerts. */
export function isLowStock({ remaining_qty, reorder_threshold }) {
  return remaining_qty <= reorder_threshold;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True when expiry_date falls within `withinDays` of `now` (default 7). */
export function isNearExpiry(expiry_date, withinDays = 7, now = new Date()) {
  if (!expiry_date) return false;
  const diff = new Date(expiry_date).getTime() - now.getTime();
  return diff >= 0 && diff <= withinDays * MS_PER_DAY;
}

export function isExpired(expiry_date, now = new Date()) {
  if (!expiry_date) return false;
  return new Date(expiry_date).getTime() < now.getTime();
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace shared`
Expected: PASS — 8 new tests.

- [ ] **Step 5: Write the failing schema test**

Create `shared/src/schemas/resource.schema.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createResourceItemSchema, createInventorySchema } from './resource.schema.js';

describe('createResourceItemSchema', () => {
  it('accepts a complete resource item', () => {
    const result = createResourceItemSchema.safeParse({ name: 'Rice', category: 'food', unit: 'kg' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid category', () => {
    const result = createResourceItemSchema.safeParse({ name: 'Rice', category: 'invalid', unit: 'kg' });
    expect(result.success).toBe(false);
  });
});

describe('createInventorySchema', () => {
  const campId = '507f1f77bcf86cd799439011';
  const itemId = '507f1f77bcf86cd799439012';

  it('accepts a complete inventory entry', () => {
    const result = createInventorySchema.safeParse({
      camp_id: campId, item_id: itemId, remaining_qty: 500, reorder_threshold: 50,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative remaining_qty', () => {
    const result = createInventorySchema.safeParse({
      camp_id: campId, item_id: itemId, remaining_qty: -1, reorder_threshold: 50,
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test --workspace shared`
Expected: FAIL — cannot resolve `./resource.schema.js`.

- [ ] **Step 7: Implement the schema**

Create `shared/src/schemas/resource.schema.js`:

```js
import { z } from 'zod';
import { objectId } from './camp.schema.js';

export const RESOURCE_CATEGORIES = ['food', 'medical', 'clothing', 'shelter', 'hygiene', 'other'];

export const createResourceItemSchema = z.object({
  name: z.string().trim().min(2, 'Item name is required.').max(120),
  category: z.enum(RESOURCE_CATEGORIES, { message: 'Select a valid category.' }),
  unit: z.string().trim().min(1, 'Unit is required (e.g. kg, liters, pieces).').max(30),
  description: z.string().trim().max(500).optional(),
});

export const createInventorySchema = z.object({
  camp_id: objectId,
  item_id: objectId,
  batch_no: z.string().trim().max(60).optional(),
  remaining_qty: z.coerce.number().nonnegative('Quantity cannot be negative.'),
  reorder_threshold: z.coerce.number().nonnegative('Threshold cannot be negative.'),
  expiry_date: z.coerce.date().optional(),
});

export const adjustInventorySchema = z.object({
  remaining_qty: z.coerce.number().nonnegative('Quantity cannot be negative.').optional(),
  reorder_threshold: z.coerce.number().nonnegative('Threshold cannot be negative.').optional(),
  expiry_date: z.coerce.date().nullable().optional(),
});
```

Modify `shared/src/index.js` — add:

```js
export * from './inventory.js';
export * from './schemas/resource.schema.js';
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npm test --workspace shared`
Expected: PASS — 4 new tests.

- [ ] **Step 9: Write the failing model test**

Create `server/src/modules/resources/inventory.model.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { ResourceItem } from './resourceItem.model.js';
import { Inventory } from './inventory.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

describe('ResourceItem', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates an item with the given category and unit', async () => {
    const item = await ResourceItem.create({ name: 'Rice', category: 'food', unit: 'kg', created_by: new mongoose.Types.ObjectId() });
    expect(item.toSafeJSON()).toMatchObject({ name: 'Rice', category: 'food', unit: 'kg' });
  });
});

describe('Inventory', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('defaults distributed_qty to zero', async () => {
    const item = await ResourceItem.create({ name: 'Rice', category: 'food', unit: 'kg', created_by: new mongoose.Types.ObjectId() });
    const inv = await Inventory.create({
      camp_id: new mongoose.Types.ObjectId(), item_id: item._id,
      remaining_qty: 500, reorder_threshold: 50, created_by: new mongoose.Types.ObjectId(),
    });
    expect(inv.distributed_qty).toBe(0);
  });

  it('toSafeJSON exposes remaining_qty and reorder_threshold', async () => {
    const item = await ResourceItem.create({ name: 'Rice', category: 'food', unit: 'kg', created_by: new mongoose.Types.ObjectId() });
    const inv = await Inventory.create({
      camp_id: new mongoose.Types.ObjectId(), item_id: item._id,
      remaining_qty: 500, reorder_threshold: 50, created_by: new mongoose.Types.ObjectId(),
    });
    expect(inv.toSafeJSON()).toMatchObject({ remaining_qty: 500, reorder_threshold: 50, distributed_qty: 0 });
  });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `npm test --workspace server -- inventory.model.test.js`
Expected: FAIL — cannot resolve `./resourceItem.model.js`.

- [ ] **Step 11: Implement the models**

Create `server/src/modules/resources/resourceItem.model.js`:

```js
import mongoose from 'mongoose';
import { RESOURCE_CATEGORIES } from '@frp/shared';

const resourceItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, required: true, enum: RESOURCE_CATEGORIES, index: true },
    unit: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'resource_items' }
);

resourceItemSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(), name: this.name, category: this.category,
    unit: this.unit, description: this.description,
  };
};

export const ResourceItem = mongoose.model('ResourceItem', resourceItemSchema);
```

Create `server/src/modules/resources/inventory.model.js`:

```js
import mongoose from 'mongoose';

const inventorySchema = new mongoose.Schema(
  {
    camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ResourceItem', required: true, index: true },
    batch_no: { type: String, default: null },
    remaining_qty: { type: Number, required: true, min: 0 },
    distributed_qty: { type: Number, default: 0, min: 0 },
    reorder_threshold: { type: Number, required: true, min: 0 },
    expiry_date: { type: Date, default: null },
    received_at: { type: Date, default: Date.now },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'inventory' }
);

inventorySchema.index({ camp_id: 1, item_id: 1 });

inventorySchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    camp_id: this.camp_id.toString(),
    item_id: this.item_id.toString(),
    batch_no: this.batch_no,
    remaining_qty: this.remaining_qty,
    distributed_qty: this.distributed_qty,
    reorder_threshold: this.reorder_threshold,
    expiry_date: this.expiry_date,
    received_at: this.received_at,
  };
};

export const Inventory = mongoose.model('Inventory', inventorySchema);
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npm test --workspace server -- inventory.model.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 13: Commit**

```bash
git add shared/ server/src/modules/resources/
git commit -m "$(cat <<'EOF'
feat: add resource and inventory domain logic and models

isLowStock/isNearExpiry/isExpired are pure, unit-tested functions
(spec section 6.8's low-stock and expiry alerts) — the same "pure
invariant function, unit tested" pattern every prior plan's core logic
follows.

ResourceItem is the admin-managed master catalog (not camp-scoped);
Inventory is a camp's stock record for one item, with remaining_qty and
distributed_qty kept separate so a dashboard can show both live —
distributed_qty is written only by the distribution service (Task 6),
never directly.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Resources and inventory service + API routes

**Files:**
- Create: `server/src/modules/resources/resources.service.js`, `server/src/modules/resources/resources.controller.js`, `server/src/modules/resources/resources.routes.js`
- Modify: `server/src/app.js`, `server/src/core/socket.js`
- Test: `server/src/modules/resources/resources.test.js`

**Interfaces:**
- Consumes: `ResourceItem`, `Inventory` (Task 1), `isLowStock` (`@frp/shared`), `emitCampOccupancy`-style pattern from `core/socket.js`, `recordAudit`, `AppError`, `authenticate`, `authorize`
- Produces: `createResourceItem`, `listResourceItems`, `createInventory`, `listInventory({camp_id?})`, `adjustInventory` (service); `emitInventoryChanged(campId, payload)`, `emitLowStock(campId, payload)` (socket); `GET|POST /api/resources`, `GET|POST /api/inventory`, `PATCH /api/inventory/:id`

- [ ] **Step 1: Add the two inventory socket events**

Modify `server/src/core/socket.js` — add after `emitCampOccupancy`:

```js
/** Same no-op-safe contract as emitCampOccupancy. */
export function emitInventoryChanged(campId, payload) {
  if (!io) return;
  io.emit('inventory:changed', { campId: String(campId), ...payload });
}

export function emitLowStock(campId, payload) {
  if (!io) return;
  io.emit('inventory:low_stock', { campId: String(campId), ...payload });
}
```

- [ ] **Step 2: Write the failing test**

Create `server/src/modules/resources/resources.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9500000000 + Math.floor(Math.random() * 499999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active', ...over,
  });
}
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

const campBody = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7, flood_severity: 'high',
  beneficiary_capacity: 400, volunteer_capacity: 30, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

async function setup() {
  const admin = await makeUser('admin');
  const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
  return { admin, campId: campRes.body.camp.id };
}

describe('POST /api/resources', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin create a resource item', async () => {
    const { admin } = await setup();
    const res = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    expect(res.status).toBe(201);
    expect(res.body.item.name).toBe('Rice');
  });

  it('refuses a donor', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).post('/api/resources').set(bearer(donor)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/resources', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lists resource items for any authenticated role', async () => {
    const { admin } = await setup();
    await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const official = await makeUser('camp_official');
    const res = await request(app).get('/api/resources').set(bearer(official));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('POST /api/inventory', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin stock a camp with an item', async () => {
    const { admin, campId } = await setup();
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const res = await request(app)
      .post('/api/inventory').set(bearer(admin))
      .send({ camp_id: campId, item_id: itemRes.body.item.id, remaining_qty: 500, reorder_threshold: 50 });
    expect(res.status).toBe(201);
    expect(res.body.inventory.remaining_qty).toBe(500);
  });
});

describe('GET /api/inventory', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('filters by camp and flags low stock', async () => {
    const { admin, campId } = await setup();
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    await request(app).post('/api/inventory').set(bearer(admin))
      .send({ camp_id: campId, item_id: itemRes.body.item.id, remaining_qty: 20, reorder_threshold: 50 });

    const res = await request(app).get(`/api/inventory?camp_id=${campId}`).set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.inventory).toHaveLength(1);
    expect(res.body.inventory[0].is_low_stock).toBe(true);
  });
});

describe('PATCH /api/inventory/:id', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin adjust remaining_qty and emits inventory:changed', async () => {
    const { admin, campId } = await setup();
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const invRes = await request(app).post('/api/inventory').set(bearer(admin))
      .send({ camp_id: campId, item_id: itemRes.body.item.id, remaining_qty: 500, reorder_threshold: 50 });

    const res = await request(app)
      .patch(`/api/inventory/${invRes.body.inventory.id}`).set(bearer(admin))
      .send({ remaining_qty: 300 });
    expect(res.status).toBe(200);
    expect(res.body.inventory.remaining_qty).toBe(300);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --workspace server -- resources.test.js`
Expected: FAIL — 404s, no `/api/resources` or `/api/inventory` routes mounted.

- [ ] **Step 4: Implement the service**

Create `server/src/modules/resources/resources.service.js`:

```js
import { ResourceItem } from './resourceItem.model.js';
import { Inventory } from './inventory.model.js';
import { isLowStock } from '@frp/shared';
import { AppError } from '../../core/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { emitInventoryChanged, emitLowStock } from '../../core/socket.js';

export async function createResourceItem(input, { actorId, actorRole, ip }) {
  const item = await ResourceItem.create({ ...input, created_by: actorId });
  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'resource_item.create',
    module: 'resources', record_id: item._id, after: item.toSafeJSON(), ip,
  });
  return item;
}

export async function listResourceItems() {
  return ResourceItem.find().sort({ name: 1 });
}

export async function createInventory(input, { actorId, actorRole, ip }) {
  const inv = await Inventory.create({ ...input, created_by: actorId });
  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'inventory.create',
    module: 'resources', record_id: inv._id, after: inv.toSafeJSON(), ip,
  });
  emitInventoryChanged(inv.camp_id, { itemId: inv.item_id.toString(), remaining_qty: inv.remaining_qty });
  return inv;
}

export async function listInventory({ camp_id } = {}) {
  const filter = {};
  if (camp_id) filter.camp_id = camp_id;
  return Inventory.find(filter).sort({ createdAt: -1 });
}

export async function getInventoryById(id) {
  const inv = await Inventory.findById(id);
  if (!inv) throw AppError.notFound('No inventory entry with that id.');
  return inv;
}

export async function adjustInventory(id, input, { actorId, actorRole, ip }) {
  const inv = await getInventoryById(id);
  const before = inv.toSafeJSON();
  Object.assign(inv, input);
  await inv.save();

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'inventory.adjust',
    module: 'resources', record_id: inv._id, before, after: inv.toSafeJSON(), ip,
  });

  emitInventoryChanged(inv.camp_id, { itemId: inv.item_id.toString(), remaining_qty: inv.remaining_qty });
  if (isLowStock(inv)) {
    emitLowStock(inv.camp_id, { itemId: inv.item_id.toString(), remaining_qty: inv.remaining_qty, reorder_threshold: inv.reorder_threshold });
  }
  return inv;
}
```

- [ ] **Step 5: Implement the controller**

Create `server/src/modules/resources/resources.controller.js`:

```js
import { isLowStock, isNearExpiry, isExpired } from '@frp/shared';
import * as resourcesService from './resources.service.js';

export async function createResourceItemHandler(req, res) {
  const item = await resourcesService.createResourceItem(req.body, { actorId: req.user.id, actorRole: req.user.role, ip: req.ip });
  res.status(201).json({ item: item.toSafeJSON() });
}

export async function listResourceItemsHandler(req, res) {
  const items = await resourcesService.listResourceItems();
  res.json({ items: items.map((i) => i.toSafeJSON()) });
}

function withStockFlags(inv) {
  const json = inv.toSafeJSON();
  return {
    ...json,
    is_low_stock: isLowStock(json),
    is_near_expiry: isNearExpiry(json.expiry_date),
    is_expired: isExpired(json.expiry_date),
  };
}

export async function createInventoryHandler(req, res) {
  const inv = await resourcesService.createInventory(req.body, { actorId: req.user.id, actorRole: req.user.role, ip: req.ip });
  res.status(201).json({ inventory: withStockFlags(inv) });
}

export async function listInventoryHandler(req, res) {
  const { camp_id } = req.query;
  const inventory = await resourcesService.listInventory({ camp_id });
  res.json({ inventory: inventory.map(withStockFlags) });
}

export async function adjustInventoryHandler(req, res) {
  const inv = await resourcesService.adjustInventory(req.params.id, req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.json({ inventory: withStockFlags(inv) });
}
```

- [ ] **Step 6: Implement the routes**

Create `server/src/modules/resources/resources.routes.js`:

```js
import { Router } from 'express';
import { createResourceItemSchema, createInventorySchema, adjustInventorySchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  createResourceItemHandler, listResourceItemsHandler,
  createInventoryHandler, listInventoryHandler, adjustInventoryHandler,
} from './resources.controller.js';

export const resourcesRouter = Router();

resourcesRouter.post('/resources', authenticate, authorize('admin'), validate(createResourceItemSchema), createResourceItemHandler);
resourcesRouter.get('/resources', authenticate, listResourceItemsHandler);
resourcesRouter.post('/inventory', authenticate, authorize('admin'), validate(createInventorySchema), createInventoryHandler);
resourcesRouter.get('/inventory', authenticate, listInventoryHandler);
resourcesRouter.patch('/inventory/:id', authenticate, authorize('admin'), validate(adjustInventorySchema), adjustInventoryHandler);
```

Modify `server/src/app.js` — add the import and mount alongside `intakeRouter`:

```js
import { resourcesRouter } from './modules/resources/resources.routes.js';
// ...
app.use('/api', resourcesRouter);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test --workspace server -- resources.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 8: Commit**

```bash
git add server/
git commit -m "$(cat <<'EOF'
feat: add resources and inventory API routes

Resource items (the master catalog) are admin-managed, create-only for
now; any authenticated role can list them, since both officials and the
distribution screen need to know what exists. Inventory entries are
camp-scoped and admin-managed; GET /inventory?camp_id= filters and
annotates each entry with is_low_stock/is_near_expiry/is_expired
(spec section 6.8), computed from Task 1's pure helpers rather than
stored — so the flags can never drift from the underlying data.

Every inventory write emits inventory:changed, and adjustInventory also
emits inventory:low_stock when the new quantity crosses the threshold —
both no-op-safe like Plan 2's emitCampOccupancy.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Notifications

**Files:**
- Create: `server/src/modules/notifications/notification.model.js`, `server/src/modules/notifications/notifications.service.js`, `server/src/modules/notifications/notifications.controller.js`, `server/src/modules/notifications/notifications.routes.js`
- Modify: `server/src/app.js`, `server/src/modules/resources/resources.service.js`
- Test: `server/src/modules/notifications/notifications.test.js`

**Interfaces:**
- Consumes: nothing new
- Produces: `createNotification({user_id, type, message, ref_id?}): Promise<Notification>`, `listNotifications(userId): Promise<Notification[]>`, `markRead(id, userId): Promise<Notification>`; `GET /api/notifications`, `POST /api/notifications/:id/read`

Low-stock crossing a threshold now also creates a persisted notification for every admin, not just a transient socket event — a socket event is missed by anyone not currently connected; a stored notification survives until read.

- [ ] **Step 1: Write the failing test**

Create `server/src/modules/notifications/notifications.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import * as notificationsService from './notifications.service.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

describe('notifications', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates and lists a notification for a user, newest first', async () => {
    const userId = new mongoose.Types.ObjectId();
    await notificationsService.createNotification({ user_id: userId, type: 'low_stock', message: 'Rice is low at Riverside Camp.' });
    await notificationsService.createNotification({ user_id: userId, type: 'low_stock', message: 'Blankets are low at Riverside Camp.' });

    const list = await notificationsService.listNotifications(userId);
    expect(list).toHaveLength(2);
    expect(list[0].message).toBe('Blankets are low at Riverside Camp.');
  });

  it('does not list another user\'s notifications', async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    await notificationsService.createNotification({ user_id: userA, type: 'low_stock', message: 'A' });
    expect(await notificationsService.listNotifications(userB)).toHaveLength(0);
  });

  it('marks a notification read', async () => {
    const userId = new mongoose.Types.ObjectId();
    const n = await notificationsService.createNotification({ user_id: userId, type: 'low_stock', message: 'A' });
    const updated = await notificationsService.markRead(n._id, userId);
    expect(updated.read).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace server -- notifications.test.js`
Expected: FAIL — cannot resolve `./notifications.service.js`.

- [ ] **Step 3: Implement it**

Create `server/src/modules/notifications/notification.model.js`:

```js
import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, enum: ['low_stock', 'expiry', 'other'], default: 'other' },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    ref_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'notifications' }
);

notificationSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(), type: this.type, message: this.message,
    ref_id: this.ref_id ? this.ref_id.toString() : null, read: this.read, createdAt: this.createdAt,
  };
};

export const Notification = mongoose.model('Notification', notificationSchema);
```

Create `server/src/modules/notifications/notifications.service.js`:

```js
import { Notification } from './notification.model.js';
import { AppError } from '../../core/errors.js';

export async function createNotification({ user_id, type, message, ref_id = null }) {
  return Notification.create({ user_id, type, message, ref_id });
}

export async function listNotifications(userId) {
  return Notification.find({ user_id: userId }).sort({ createdAt: -1 }).limit(50);
}

export async function markRead(id, userId) {
  const n = await Notification.findOne({ _id: id, user_id: userId });
  if (!n) throw AppError.notFound('No notification with that id.');
  n.read = true;
  await n.save();
  return n;
}
```

Create `server/src/modules/notifications/notifications.controller.js`:

```js
import * as notificationsService from './notifications.service.js';

export async function listNotificationsHandler(req, res) {
  const list = await notificationsService.listNotifications(req.user.id);
  res.json({ notifications: list.map((n) => n.toSafeJSON()) });
}

export async function markReadHandler(req, res) {
  const n = await notificationsService.markRead(req.params.id, req.user.id);
  res.json({ notification: n.toSafeJSON() });
}
```

Create `server/src/modules/notifications/notifications.routes.js`:

```js
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { listNotificationsHandler, markReadHandler } from './notifications.controller.js';

export const notificationsRouter = Router();
notificationsRouter.get('/notifications', authenticate, listNotificationsHandler);
notificationsRouter.post('/notifications/:id/read', authenticate, markReadHandler);
```

Modify `server/src/app.js` — add the import and mount:

```js
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
// ...
app.use('/api', notificationsRouter);
```

Modify `server/src/modules/resources/resources.service.js` — notify every admin when stock crosses the low threshold. Add the import:

```js
import { User } from '../auth/user.model.js';
import { createNotification } from '../notifications/notifications.service.js';
```

Replace the `if (isLowStock(inv))` block in `adjustInventory` with:

```js
  if (isLowStock(inv)) {
    emitLowStock(inv.camp_id, { itemId: inv.item_id.toString(), remaining_qty: inv.remaining_qty, reorder_threshold: inv.reorder_threshold });
    const admins = await User.find({ role: 'admin', status: 'active' });
    await Promise.all(
      admins.map((a) =>
        createNotification({
          user_id: a._id, type: 'low_stock', ref_id: inv._id,
          message: `Stock running low: ${inv.remaining_qty} ${inv.item_id} remaining at threshold ${inv.reorder_threshold}.`,
        })
      )
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace server -- notifications.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "$(cat <<'EOF'
feat: add notifications, wired to low-stock crossings

A stored notification per admin survives being offline when the
socket event fires — inventory:low_stock is transient and only reaches
whoever's connected at that instant; the notification is there when
they next check.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Distribution rules — calcRation and the hybrid rule engine

**Files:**
- Create: `shared/src/distribution.js`
- Create: `shared/src/schemas/distributionRule.schema.js`
- Create: `server/src/modules/resources/distributionRule.model.js`
- Modify: `shared/src/index.js`
- Test: `shared/src/distribution.test.js`, `shared/src/schemas/distributionRule.schema.test.js`, `server/src/modules/resources/distributionRule.model.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `calcRation(rule, members): number`, `computePeriodKey(period, date?): string`, `createDistributionRuleSchema`, `DistributionRule` model with `toSafeJSON()`

**`priority_addons[].when` and `eligibility[]` vocabulary (a judgment call — spec names the mechanism but not its values):** `'has_pregnant'`, `'has_disability'`, `'has_senior_citizen'`, `'has_child'`, checked against `is_pregnant`/`has_disability`/`priority_tags` on the members passed in. An item with `eligibility: ['has_child']` (e.g. infant formula) distributes zero to a family with no children — Task 6's distribution service treats a zero result as "not eligible," not "distribute nothing silently."

- [ ] **Step 1: Write the failing test**

Create `shared/src/distribution.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { calcRation, computePeriodKey } from './distribution.js';

const member = (over = {}) => ({ is_pregnant: false, has_disability: false, priority_tags: [], ...over });

describe('calcRation', () => {
  it('returns a fixed quantity regardless of family size', () => {
    const rule = { active: true, mode: 'fixed', fixed_qty: 2 };
    expect(calcRation(rule, [member(), member(), member()])).toBe(2);
  });

  it('multiplies per-head quantity by family size', () => {
    const rule = { active: true, mode: 'per_head', per_head_qty: 0.5 };
    expect(calcRation(rule, [member(), member()])).toBe(1);
  });

  it('picks the matching family band', () => {
    const rule = {
      active: true, mode: 'family_band',
      bands: [{ min: 1, max: 2, qty: 5 }, { min: 3, max: 5, qty: 10 }],
    };
    expect(calcRation(rule, [member(), member(), member()])).toBe(10);
  });

  it('returns 0 for a family band outside every range', () => {
    const rule = { active: true, mode: 'family_band', bands: [{ min: 1, max: 2, qty: 5 }] };
    expect(calcRation(rule, [member(), member(), member()])).toBe(0);
  });

  it('adds a priority addon when a matching member is present', () => {
    const rule = {
      active: true, mode: 'fixed', fixed_qty: 2,
      priority_addons: [{ when: 'has_pregnant', extra_qty: 1 }],
    };
    expect(calcRation(rule, [member({ is_pregnant: true })])).toBe(3);
  });

  it('clamps to min_qty and max_qty', () => {
    const low = { active: true, mode: 'fixed', fixed_qty: 1, min_qty: 3 };
    expect(calcRation(low, [member()])).toBe(3);
    const high = { active: true, mode: 'fixed', fixed_qty: 100, max_qty: 10 };
    expect(calcRation(high, [member()])).toBe(10);
  });

  it('returns 0 when eligibility requires a tag no member has', () => {
    const rule = { active: true, mode: 'fixed', fixed_qty: 5, eligibility: ['has_child'] };
    expect(calcRation(rule, [member()])).toBe(0);
  });

  it('returns 0 for an inactive rule', () => {
    const rule = { active: false, mode: 'fixed', fixed_qty: 5 };
    expect(calcRation(rule, [member()])).toBe(0);
  });
});

describe('computePeriodKey', () => {
  it('returns "once" for a one-time rule regardless of date', () => {
    expect(computePeriodKey('once', new Date('2026-08-12'))).toBe('once');
  });

  it('returns an ISO date for a daily rule', () => {
    expect(computePeriodKey('daily', new Date('2026-08-12T15:00:00Z'))).toBe('2026-08-12');
  });

  it('returns the same key for two daily distributions on the same day', () => {
    const a = computePeriodKey('daily', new Date('2026-08-12T01:00:00Z'));
    const b = computePeriodKey('daily', new Date('2026-08-12T23:00:00Z'));
    expect(a).toBe(b);
  });

  it('returns an ISO week key for a weekly rule', () => {
    expect(computePeriodKey('weekly', new Date('2026-08-12T00:00:00Z'))).toMatch(/^2026-W\d{2}$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace shared`
Expected: FAIL — cannot resolve `./distribution.js`.

- [ ] **Step 3: Implement it**

Create `shared/src/distribution.js`:

```js
function memberHasTag(member, tag) {
  if (tag === 'has_pregnant') return member.is_pregnant === true;
  if (tag === 'has_disability') return member.has_disability === true;
  if (tag === 'has_child') return (member.priority_tags || []).includes('child');
  if (tag === 'has_senior_citizen') return (member.priority_tags || []).includes('senior_citizen');
  return false;
}

/**
 * Ration quantity from a distribution rule (spec section 3.1). Pure and
 * unit-tested — the hybrid engine's whole point is that this function is
 * the single place that logic lives, not scattered across the service.
 */
export function calcRation(rule, members) {
  if (!rule || !rule.active) return 0;

  if (rule.eligibility && rule.eligibility.length > 0) {
    const eligible = members.some((m) => rule.eligibility.some((tag) => memberHasTag(m, tag)));
    if (!eligible) return 0;
  }

  let qty;
  if (rule.mode === 'fixed') {
    qty = rule.fixed_qty;
  } else if (rule.mode === 'per_head') {
    qty = rule.per_head_qty * members.length;
  } else if (rule.mode === 'family_band') {
    const band = (rule.bands || []).find((b) => members.length >= b.min && members.length <= b.max);
    qty = band ? band.qty : 0;
  } else {
    qty = 0;
  }

  for (const addon of rule.priority_addons || []) {
    if (members.some((m) => memberHasTag(m, addon.when))) qty += addon.extra_qty;
  }

  if (rule.min_qty != null) qty = Math.max(qty, rule.min_qty);
  if (rule.max_qty != null) qty = Math.min(qty, rule.max_qty);

  return qty;
}

/**
 * period_key for distribution_records' uniqueness (spec section 5.4):
 * '2026-08-12' for daily, '2026-W33' (ISO week) for weekly, 'once' once.
 */
export function computePeriodKey(period, date = new Date()) {
  if (period === 'once') return 'once';
  if (period === 'daily') return date.toISOString().slice(0, 10);
  if (period === 'weekly') {
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNr = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  throw new Error(`Unknown period: ${period}`);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace shared`
Expected: PASS — 12 new tests.

- [ ] **Step 5: Write the failing schema test**

Create `shared/src/schemas/distributionRule.schema.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createDistributionRuleSchema } from './distributionRule.schema.js';

const itemId = '507f1f77bcf86cd799439012';

describe('createDistributionRuleSchema', () => {
  it('accepts a fixed-mode rule', () => {
    const result = createDistributionRuleSchema.safeParse({
      item_id: itemId, mode: 'fixed', period: 'daily', fixed_qty: 2,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a family_band-mode rule with bands', () => {
    const result = createDistributionRuleSchema.safeParse({
      item_id: itemId, mode: 'family_band', period: 'weekly',
      bands: [{ min: 1, max: 2, qty: 5 }, { min: 3, max: 6, qty: 10 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid mode', () => {
    const result = createDistributionRuleSchema.safeParse({ item_id: itemId, mode: 'nonsense', period: 'daily' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test --workspace shared`
Expected: FAIL — cannot resolve `./distributionRule.schema.js`.

- [ ] **Step 7: Implement it**

Create `shared/src/schemas/distributionRule.schema.js`:

```js
import { z } from 'zod';
import { objectId } from './camp.schema.js';

export const DISTRIBUTION_MODES = ['per_head', 'family_band', 'fixed'];
export const DISTRIBUTION_PERIODS = ['daily', 'weekly', 'once'];
export const ELIGIBILITY_TAGS = ['has_pregnant', 'has_disability', 'has_senior_citizen', 'has_child'];

const bandSchema = z.object({
  min: z.coerce.number().int().nonnegative(),
  max: z.coerce.number().int().nonnegative(),
  qty: z.coerce.number().nonnegative(),
});

const addonSchema = z.object({
  when: z.enum(ELIGIBILITY_TAGS),
  extra_qty: z.coerce.number().nonnegative(),
});

export const createDistributionRuleSchema = z.object({
  item_id: objectId,
  camp_id: objectId.nullable().optional(),
  mode: z.enum(DISTRIBUTION_MODES, { message: 'Select a valid mode.' }),
  period: z.enum(DISTRIBUTION_PERIODS, { message: 'Select a valid period.' }),
  bands: z.array(bandSchema).optional(),
  per_head_qty: z.coerce.number().nonnegative().optional(),
  fixed_qty: z.coerce.number().nonnegative().optional(),
  priority_addons: z.array(addonSchema).optional(),
  eligibility: z.array(z.enum(ELIGIBILITY_TAGS)).optional(),
  min_qty: z.coerce.number().nonnegative().optional(),
  max_qty: z.coerce.number().nonnegative().optional(),
  effective_from: z.coerce.date().optional(),
  effective_to: z.coerce.date().optional(),
  active: z.boolean().default(true),
});
```

Modify `shared/src/index.js` — add:

```js
export * from './distribution.js';
export * from './schemas/distributionRule.schema.js';
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npm test --workspace shared`
Expected: PASS — 3 new tests.

- [ ] **Step 9: Write the failing model test**

Create `server/src/modules/resources/distributionRule.model.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { DistributionRule } from './distributionRule.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

describe('DistributionRule', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('defaults active to true and camp_id to null (a global default rule)', async () => {
    const rule = await DistributionRule.create({
      item_id: new mongoose.Types.ObjectId(), mode: 'fixed', period: 'daily', fixed_qty: 2,
      created_by: new mongoose.Types.ObjectId(),
    });
    expect(rule.active).toBe(true);
    expect(rule.camp_id).toBeNull();
  });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `npm test --workspace server -- distributionRule.model.test.js`
Expected: FAIL — cannot resolve `./distributionRule.model.js`.

- [ ] **Step 11: Implement the model**

Create `server/src/modules/resources/distributionRule.model.js`:

```js
import mongoose from 'mongoose';

const bandSchema = new mongoose.Schema({ min: Number, max: Number, qty: Number }, { _id: false });
const addonSchema = new mongoose.Schema({ when: String, extra_qty: Number }, { _id: false });

const distributionRuleSchema = new mongoose.Schema(
  {
    item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ResourceItem', required: true, index: true },
    camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', default: null, index: true }, // null = global default
    mode: { type: String, required: true, enum: ['per_head', 'family_band', 'fixed'] },
    period: { type: String, required: true, enum: ['daily', 'weekly', 'once'] },
    bands: { type: [bandSchema], default: [] },
    per_head_qty: { type: Number, default: null },
    fixed_qty: { type: Number, default: null },
    priority_addons: { type: [addonSchema], default: [] },
    eligibility: { type: [String], default: [] },
    min_qty: { type: Number, default: null },
    max_qty: { type: Number, default: null },
    effective_from: { type: Date, default: null },
    effective_to: { type: Date, default: null },
    active: { type: Boolean, default: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'distribution_rules' }
);

distributionRuleSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(), item_id: this.item_id.toString(),
    camp_id: this.camp_id ? this.camp_id.toString() : null,
    mode: this.mode, period: this.period, bands: this.bands,
    per_head_qty: this.per_head_qty, fixed_qty: this.fixed_qty,
    priority_addons: this.priority_addons, eligibility: this.eligibility,
    min_qty: this.min_qty, max_qty: this.max_qty,
    effective_from: this.effective_from, effective_to: this.effective_to, active: this.active,
  };
};

export const DistributionRule = mongoose.model('DistributionRule', distributionRuleSchema);
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npm test --workspace server -- distributionRule.model.test.js`
Expected: PASS — 1 test.

- [ ] **Step 13: Add the distribution-rules API routes**

Create `server/src/modules/resources/distributionRules.controller.js`:

```js
import { DistributionRule } from './distributionRule.model.js';
import { recordAudit } from '../audit/audit.service.js';

export async function createDistributionRuleHandler(req, res) {
  const rule = await DistributionRule.create({ ...req.body, created_by: req.user.id });
  await recordAudit({
    actor_id: req.user.id, actor_role: req.user.role, action: 'distribution_rule.create',
    module: 'resources', record_id: rule._id, after: rule.toSafeJSON(), ip: req.ip,
  });
  res.status(201).json({ rule: rule.toSafeJSON() });
}

export async function listDistributionRulesHandler(req, res) {
  const filter = {};
  if (req.query.item_id) filter.item_id = req.query.item_id;
  const rules = await DistributionRule.find(filter).sort({ createdAt: -1 });
  res.json({ rules: rules.map((r) => r.toSafeJSON()) });
}
```

Modify `server/src/modules/resources/resources.routes.js` — add the import and routes:

```js
import { createDistributionRuleSchema } from '@frp/shared';
import { createDistributionRuleHandler, listDistributionRulesHandler } from './distributionRules.controller.js';
```

```js
resourcesRouter.post('/distribution-rules', authenticate, authorize('admin'), validate(createDistributionRuleSchema), createDistributionRuleHandler);
resourcesRouter.get('/distribution-rules', authenticate, listDistributionRulesHandler);
```

- [ ] **Step 14: Commit**

```bash
git add shared/ server/
git commit -m "$(cat <<'EOF'
feat: add the distribution rule hybrid engine

calcRation(rule, members) is the single place the hybrid engine's logic
lives — fixed/per_head/family_band modes, priority addons, an
eligibility gate that returns 0 (not an error) when no member qualifies,
and min/max clamping. computePeriodKey turns a rule's period into the
exact string distribution_records' unique index uses.

priority_addons[].when and eligibility[] use a fixed four-tag
vocabulary (has_pregnant/has_disability/has_senior_citizen/has_child) —
the spec names the mechanism but not its values, so this is a
documented judgment call, isolated to one small lookup function.

camp_id: null on a rule means a global default, applying to every camp
that doesn't have its own camp-specific override for the same item.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Volunteer duty assignment and completion

**Files:**
- Modify: `server/src/modules/intake/intake.service.js`, `server/src/modules/intake/intake.controller.js`, `server/src/modules/intake/intake.routes.js`
- Test: `server/src/modules/intake/volunteerDuty.test.js`

**Interfaces:**
- Consumes: `RegistrationMember` (Plan 3)
- Produces: `assignVolunteerDuty(memberId, {task, shift}, {actorId,actorRole,actorCampId,ip}): Promise<RegistrationMember>`, `completeVolunteerDuty(memberId, {hours}, {actorId,actorRole,actorCampId,ip}): Promise<RegistrationMember>`; `POST /api/volunteers/:memberId/assign`, `POST /api/volunteers/:memberId/complete`

`intake/` already owns `registration_members`, where `volunteer_status`/`volunteer_task`/`volunteer_shift`/`volunteer_hours` live — a duty is a state transition on a member the module already owns, not a new collection.

- [ ] **Step 1: Write the failing test**

Create `server/src/modules/intake/volunteerDuty.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9600000000 + Math.floor(Math.random() * 399999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active', ...over,
  });
}
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

const campBody = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7, flood_severity: 'high',
  beneficiary_capacity: 10, volunteer_capacity: 5, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

async function registerVolunteer() {
  const admin = await makeUser('admin');
  const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
  const campId = campRes.body.camp.id;
  const person = await makeUser('affected_person');
  const regRes = await request(app).post('/api/registrations').set(bearer(person)).send({
    camp_id: campId,
    members: [{
      name: 'Meena Devi', age: 34, gender: 'female', aadhaar: '234567890658',
      mobile: '9876543210', address: '12 River Road', wants_to_volunteer: true,
    }],
  });
  return { campId, memberId: regRes.body.members[0].id, admin };
}

describe('POST /api/volunteers/:memberId/assign', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('assigns a task and shift to an accepted volunteer', async () => {
    const { memberId, admin } = await registerVolunteer();
    const res = await request(app)
      .post(`/api/volunteers/${memberId}/assign`).set(bearer(admin))
      .send({ task: 'Food distribution', shift: 'Morning' });
    expect(res.status).toBe(200);
    expect(res.body.member.volunteer_status).toBe('active');
    expect(res.body.member.volunteer_task).toBe('Food distribution');
  });

  it('refuses a donor', async () => {
    const { memberId } = await registerVolunteer();
    const donor = await makeUser('donor');
    const res = await request(app).post(`/api/volunteers/${memberId}/assign`).set(bearer(donor)).send({ task: 'X', shift: 'Y' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/volunteers/:memberId/complete', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('marks the duty completed with logged hours', async () => {
    const { memberId, admin } = await registerVolunteer();
    await request(app).post(`/api/volunteers/${memberId}/assign`).set(bearer(admin)).send({ task: 'Food distribution', shift: 'Morning' });

    const res = await request(app).post(`/api/volunteers/${memberId}/complete`).set(bearer(admin)).send({ hours: 4 });
    expect(res.status).toBe(200);
    expect(res.body.member.volunteer_status).toBe('completed');
    expect(res.body.member.volunteer_hours).toBe(4);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace server -- volunteerDuty.test.js`
Expected: FAIL — 404, no `/api/volunteers` routes mounted.

- [ ] **Step 3: Implement it**

Modify `server/src/modules/intake/intake.service.js` — add at the end:

```js
export async function assignVolunteerDuty(memberId, { task, shift }, { actorId, actorRole, actorCampId, ip }) {
  const member = await RegistrationMember.findById(memberId);
  if (!member) throw AppError.notFound('No volunteer with that id.');
  const beneficiary = await Beneficiary.findById(member.beneficiary_id);
  if (actorRole === 'camp_official' && String(beneficiary.camp_id) !== String(actorCampId)) {
    throw AppError.forbidden('You may only assign duties at your assigned camp.');
  }
  if (member.volunteer_status !== 'accepted' && member.volunteer_status !== 'active') {
    throw AppError.badRequest('This member has not been accepted as a volunteer.');
  }

  member.volunteer_task = task;
  member.volunteer_shift = shift;
  member.volunteer_status = 'active';
  await member.save();

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'volunteer.assign',
    module: 'intake', record_id: member._id, after: { task, shift }, ip,
  });
  return member;
}

export async function completeVolunteerDuty(memberId, { hours }, { actorId, actorRole, actorCampId, ip }) {
  const member = await RegistrationMember.findById(memberId);
  if (!member) throw AppError.notFound('No volunteer with that id.');
  const beneficiary = await Beneficiary.findById(member.beneficiary_id);
  if (actorRole === 'camp_official' && String(beneficiary.camp_id) !== String(actorCampId)) {
    throw AppError.forbidden('You may only complete duties at your assigned camp.');
  }

  member.volunteer_status = 'completed';
  member.volunteer_hours = (member.volunteer_hours || 0) + hours;
  await member.save();

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'volunteer.complete',
    module: 'intake', record_id: member._id, after: { hours: member.volunteer_hours }, ip,
  });
  return member;
}
```

Modify `server/src/modules/intake/intake.controller.js` — add:

```js
export async function assignVolunteerDutyHandler(req, res) {
  const member = await intakeService.assignVolunteerDuty(req.params.memberId, req.body, {
    actorId: req.user.id, actorRole: req.user.role, actorCampId: req.user.camp_id, ip: req.ip,
  });
  res.json({ member: member.toSafeJSON() });
}

export async function completeVolunteerDutyHandler(req, res) {
  const member = await intakeService.completeVolunteerDuty(req.params.memberId, req.body, {
    actorId: req.user.id, actorRole: req.user.role, actorCampId: req.user.camp_id, ip: req.ip,
  });
  res.json({ member: member.toSafeJSON() });
}
```

Modify `server/src/modules/intake/intake.routes.js` — add the import and routes:

```js
import { /* ...existing, */ assignVolunteerDutyHandler, completeVolunteerDutyHandler } from './intake.controller.js';
```

```js
intakeRouter.post('/volunteers/:memberId/assign', authenticate, authorize('admin', 'camp_official'), assignVolunteerDutyHandler);
intakeRouter.post('/volunteers/:memberId/complete', authenticate, authorize('admin', 'camp_official'), completeVolunteerDutyHandler);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace server -- volunteerDuty.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/intake/
git commit -m "$(cat <<'EOF'
feat: add volunteer duty assignment and completion

A duty is a state transition on registration_members (task/shift set,
status moves accepted -> active -> completed with hours logged) —
intake/ already owns that collection, so this extends the existing
module rather than creating a new one for what is, mechanically, two
more member fields.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Distribution service — the atomic transaction

**Files:**
- Create: `server/src/modules/distribution/distributionRecord.model.js`, `server/src/modules/distribution/distribution.service.js`
- Modify: `shared/src/schemas/distributionRule.schema.js`
- Test: `server/src/modules/distribution/distribution.service.test.js`

**Interfaces:**
- Consumes: `calcRation`, `computePeriodKey` (`@frp/shared`, Task 4), `DistributionRule`, `Inventory` (Tasks 1, 4), `Beneficiary`, `RegistrationMember` (Plan 3), `withTransaction`, `AppError`, `recordAudit`, `emitInventoryChanged`, `emitLowStock`
- Produces: `distributeItem({beneficiary_id, item_id, override_reason?}, {actorId,actorRole,ip}): Promise<DistributionRecord>`

**Spec §5.4, verbatim order:** insert the distribution record first (the unique-index conflict surfaces here, before touching stock) → deduct stock atomically → audit + low-stock notification. Verification policy: a beneficiary with zero checked-in members is blocked unless `override_reason` is supplied.

- [ ] **Step 1: Add the distributeItemSchema**

Modify `shared/src/schemas/distributionRule.schema.js` — add at the end:

```js
export const distributeItemSchema = z.object({
  beneficiary_id: objectId,
  item_id: objectId,
  override_reason: z.string().trim().min(1).max(500).optional(),
});
```

- [ ] **Step 2: Write the failing test**

Create `server/src/modules/distribution/distribution.service.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import * as distributionService from './distribution.service.js';
import { DistributionRule } from '../resources/distributionRule.model.js';
import { ResourceItem } from '../resources/resourceItem.model.js';
import { Inventory } from '../resources/inventory.model.js';
import { Beneficiary } from '../intake/beneficiary.model.js';
import { RegistrationMember } from '../intake/registrationMember.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const actor = () => ({ actorId: new mongoose.Types.ObjectId(), actorRole: 'admin', ip: '127.0.0.1' });

async function setup({ checkedIn = true, capacity = 500, threshold = 50 } = {}) {
  const campId = new mongoose.Types.ObjectId();
  const item = await ResourceItem.create({ name: 'Rice', category: 'food', unit: 'kg', created_by: new mongoose.Types.ObjectId() });
  await Inventory.create({
    camp_id: campId, item_id: item._id, remaining_qty: capacity, reorder_threshold: threshold,
    created_by: new mongoose.Types.ObjectId(),
  });
  await DistributionRule.create({
    item_id: item._id, mode: 'fixed', period: 'daily', fixed_qty: 5, active: true,
    created_by: new mongoose.Types.ObjectId(),
  });
  const beneficiary = await Beneficiary.create({
    beneficiary_code: 'BEN-9001', user_id: new mongoose.Types.ObjectId(), camp_id: campId,
    status: checkedIn ? 'active' : 'applied',
  });
  await RegistrationMember.create({
    beneficiary_id: beneficiary._id, is_primary: true, name: 'Meena Devi', age: 34, gender: 'female',
    aadhaar_hash: 'hash-1', aadhaar_enc: 'enc-1', aadhaar_last4: '0001',
    checkin_status: checkedIn ? 'checked_in' : 'pending', is_active_registration: true,
  });
  return { item, beneficiary };
}

describe('distributeItem', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('records a distribution and deducts stock by the ration amount', async () => {
    const { item, beneficiary } = await setup();
    const record = await distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor());
    expect(record.quantity).toBe(5);

    const inv = await Inventory.findOne({ item_id: item._id });
    expect(inv.remaining_qty).toBe(495);
    expect(inv.distributed_qty).toBe(5);
  });

  it('blocks a same-day repeat for the same beneficiary and item', async () => {
    const { item, beneficiary } = await setup();
    await distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor());
    await expect(
      distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor())
    ).rejects.toMatchObject({ code: 'ALREADY_DISTRIBUTED' });
  });

  it('refuses when stock is insufficient, leaving inventory unchanged', async () => {
    const { item, beneficiary } = await setup({ capacity: 3 });
    await expect(
      distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor())
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    const inv = await Inventory.findOne({ item_id: item._id });
    expect(inv.remaining_qty).toBe(3);
  });

  it('blocks distribution to a beneficiary with no checked-in members, without an override', async () => {
    const { item, beneficiary } = await setup({ checkedIn: false });
    await expect(
      distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor())
    ).rejects.toMatchObject({ code: 'NOT_VERIFIED' });
  });

  it('allows distribution to an unverified beneficiary with a recorded override reason', async () => {
    const { item, beneficiary } = await setup({ checkedIn: false });
    const record = await distributionService.distributeItem(
      { beneficiary_id: beneficiary._id, item_id: item._id, override_reason: 'Family arrived injured, distributing before formal check-in.' },
      actor()
    );
    expect(record.override_reason).toBeTruthy();
  });

  it('never overshoots stock under two concurrent distribution attempts for different beneficiaries', async () => {
    const { item, beneficiary: b1 } = await setup({ capacity: 8 });
    const b2 = await Beneficiary.create({
      beneficiary_code: 'BEN-9002', user_id: new mongoose.Types.ObjectId(), camp_id: b1.camp_id, status: 'active',
    });
    await RegistrationMember.create({
      beneficiary_id: b2._id, is_primary: true, name: 'Raju', age: 40, gender: 'male',
      aadhaar_hash: 'hash-2', aadhaar_enc: 'enc-2', aadhaar_last4: '0002',
      checkin_status: 'checked_in', is_active_registration: true,
    });

    const results = await Promise.allSettled([
      distributionService.distributeItem({ beneficiary_id: b1._id, item_id: item._id }, actor()),
      distributionService.distributeItem({ beneficiary_id: b2._id, item_id: item._id }, actor()),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    // Rule gives 5/beneficiary; capacity 8 fits only one of the two.
    expect(fulfilled).toHaveLength(1);
    const inv = await Inventory.findOne({ item_id: item._id });
    expect(inv.remaining_qty).toBe(3);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --workspace server -- distribution.service.test.js`
Expected: FAIL — cannot resolve `./distribution.service.js`.

- [ ] **Step 4: Implement the model and service**

Create `server/src/modules/distribution/distributionRecord.model.js`:

```js
import mongoose from 'mongoose';

const distributionRecordSchema = new mongoose.Schema(
  {
    beneficiary_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', required: true, index: true },
    camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ResourceItem', required: true, index: true },
    quantity: { type: Number, required: true, min: 0 },
    period_key: { type: String, required: true },
    distributed_at: { type: Date, default: Date.now },
    distributed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    override_reason: { type: String, default: null },
  },
  { timestamps: true, collection: 'distribution_records' }
);

distributionRecordSchema.index({ beneficiary_id: 1, item_id: 1, period_key: 1 }, { unique: true });

distributionRecordSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    beneficiary_id: this.beneficiary_id.toString(),
    camp_id: this.camp_id.toString(),
    item_id: this.item_id.toString(),
    quantity: this.quantity, period_key: this.period_key,
    distributed_at: this.distributed_at, override_reason: this.override_reason,
  };
};

export const DistributionRecord = mongoose.model('DistributionRecord', distributionRecordSchema);
```

Create `server/src/modules/distribution/distribution.service.js`:

```js
import { calcRation, computePeriodKey, isLowStock } from '@frp/shared';
import { DistributionRecord } from './distributionRecord.model.js';
import { DistributionRule } from '../resources/distributionRule.model.js';
import { Inventory } from '../resources/inventory.model.js';
import { Beneficiary } from '../intake/beneficiary.model.js';
import { RegistrationMember } from '../intake/registrationMember.model.js';
import { withTransaction } from '../../core/transaction.js';
import { AppError } from '../../core/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { emitInventoryChanged, emitLowStock } from '../../core/socket.js';

/**
 * The distribution transaction. Spec section 5.4, verbatim order: insert
 * the record first (its unique index on beneficiary+item+period catches a
 * repeat atomically, before anything touches stock), then deduct stock
 * guarded exactly like Plan 2's beneficiary-capacity check. Verification
 * policy: a beneficiary with zero checked-in members is blocked by default
 * — an official override requires a recorded reason and is itself audited.
 */
export async function distributeItem({ beneficiary_id, item_id, override_reason }, { actorId, actorRole, ip }) {
  return withTransaction(async (session) => {
    const beneficiary = await Beneficiary.findById(beneficiary_id).session(session);
    if (!beneficiary) throw AppError.notFound('No beneficiary with that id.');

    const members = await RegistrationMember.find({ beneficiary_id }).session(session);
    const checkedIn = members.filter((m) => m.checkin_status === 'checked_in');
    if (checkedIn.length === 0 && !override_reason) {
      throw AppError.conflict(
        'NOT_VERIFIED',
        'This beneficiary has no checked-in members. Provide an override reason to distribute anyway.',
        [{ path: 'override_reason', message: 'An override reason is required for an unverified beneficiary.' }]
      );
    }
    const ration_basis = checkedIn.length > 0 ? checkedIn : members;

    const rule =
      (await DistributionRule.findOne({ item_id, camp_id: beneficiary.camp_id, active: true }).session(session)) ||
      (await DistributionRule.findOne({ item_id, camp_id: null, active: true }).session(session));
    if (!rule) throw AppError.notFound('No active distribution rule for this item.');

    const quantity = calcRation(rule, ration_basis);
    if (quantity <= 0) {
      throw AppError.conflict('NOT_ELIGIBLE', 'This beneficiary is not eligible for this item under the active rule.');
    }

    const period_key = computePeriodKey(rule.period);

    let record;
    try {
      [record] = await DistributionRecord.create(
        [{ beneficiary_id, camp_id: beneficiary.camp_id, item_id, quantity, period_key, distributed_by: actorId, override_reason: override_reason ?? null }],
        { session }
      );
    } catch (err) {
      if (err?.code === 11000) {
        throw AppError.conflict('ALREADY_DISTRIBUTED', 'Already distributed for this period.');
      }
      throw err;
    }

    const updatedInventory = await Inventory.findOneAndUpdate(
      { camp_id: beneficiary.camp_id, item_id, remaining_qty: { $gte: quantity } },
      { $inc: { remaining_qty: -quantity, distributed_qty: quantity } },
      { new: true, session }
    );
    if (!updatedInventory) {
      throw AppError.conflict('INSUFFICIENT_STOCK', 'Not enough stock remaining for this item.');
    }

    await recordAudit({
      actor_id: actorId, actor_role: actorRole, action: 'distribution.create',
      module: 'distribution', record_id: record._id,
      after: { beneficiary_code: beneficiary.beneficiary_code, item_id: String(item_id), quantity, period_key, override_reason: override_reason ?? null },
      ip, session,
    });

    emitInventoryChanged(beneficiary.camp_id, { itemId: String(item_id), remaining_qty: updatedInventory.remaining_qty });
    if (isLowStock(updatedInventory)) {
      emitLowStock(beneficiary.camp_id, { itemId: String(item_id), remaining_qty: updatedInventory.remaining_qty, reorder_threshold: updatedInventory.reorder_threshold });
    }

    return record;
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace server -- distribution.service.test.js`
Expected: PASS — 6 tests. The concurrent test occasionally takes longer.

- [ ] **Step 6: Commit**

```bash
git add shared/ server/src/modules/distribution/
git commit -m "$(cat <<'EOF'
feat: add the distribution transaction — duplicate-proof and stock-safe

distributeItem() is spec section 5.4's exact sequence: the distribution
record is inserted FIRST, so its unique index on
{beneficiary_id, item_id, period_key} catches a same-period repeat
atomically before anything touches stock, then the stock deduction is
guarded exactly like Plan 2's beneficiary-capacity check — null means
insufficient stock, abort.

Verification policy: a beneficiary with zero checked-in members is
blocked by default (a database constraint must never be the thing that
refuses a starving, unverified family — spec section 5.4's own words),
but an official override requires a recorded reason, which is itself
part of the audit trail.

Proven with a real concurrent-distribution race test where capacity
fits exactly one of two simultaneous beneficiaries, not just code
review.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Distribution API routes

**Files:**
- Create: `server/src/modules/distribution/distribution.controller.js`, `server/src/modules/distribution/distribution.routes.js`
- Modify: `server/src/app.js`
- Test: `server/src/modules/distribution/distribution.routes.test.js`

**Interfaces:**
- Consumes: `distributeItem` (Task 6), `distributeItemSchema` (`@frp/shared`, Task 6)
- Produces: `POST /api/distributions`, `GET /api/distributions?beneficiary=&camp=&date=`

- [ ] **Step 1: Write the failing test**

Create `server/src/modules/distribution/distribution.routes.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9700000000 + Math.floor(Math.random() * 299999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active', ...over,
  });
}
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

const campBody = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7, flood_severity: 'high',
  beneficiary_capacity: 10, volunteer_capacity: 5, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

async function setup() {
  const admin = await makeUser('admin');
  const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
  const campId = campRes.body.camp.id;
  const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
  const itemId = itemRes.body.item.id;
  await request(app).post('/api/inventory').set(bearer(admin)).send({ camp_id: campId, item_id: itemId, remaining_qty: 500, reorder_threshold: 50 });
  await request(app).post('/api/distribution-rules').set(bearer(admin)).send({ item_id: itemId, mode: 'fixed', period: 'daily', fixed_qty: 5 });

  const person = await makeUser('affected_person');
  const regRes = await request(app).post('/api/registrations').set(bearer(person)).send({
    camp_id: campId,
    members: [{ name: 'Meena Devi', age: 34, gender: 'female', aadhaar: '234567890672', mobile: '9876543210', address: '12 River Road' }],
  });
  const beneficiaryId = regRes.body.beneficiary.id;
  await request(app).post(`/api/registrations/${beneficiaryId}/members/${regRes.body.members[0].id}/checkin`).set(bearer(admin));

  return { admin, campId, itemId, beneficiaryId };
}

describe('POST /api/distributions', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin distribute an item', async () => {
    const { admin, itemId, beneficiaryId } = await setup();
    const res = await request(app).post('/api/distributions').set(bearer(admin)).send({ beneficiary_id: beneficiaryId, item_id: itemId });
    expect(res.status).toBe(201);
    expect(res.body.distribution.quantity).toBe(5);
  });

  it('refuses a donor', async () => {
    const { itemId, beneficiaryId } = await setup();
    const donor = await makeUser('donor');
    const res = await request(app).post('/api/distributions').set(bearer(donor)).send({ beneficiary_id: beneficiaryId, item_id: itemId });
    expect(res.status).toBe(403);
  });

  it('returns 409 on a same-day repeat', async () => {
    const { admin, itemId, beneficiaryId } = await setup();
    await request(app).post('/api/distributions').set(bearer(admin)).send({ beneficiary_id: beneficiaryId, item_id: itemId });
    const res = await request(app).post('/api/distributions').set(bearer(admin)).send({ beneficiary_id: beneficiaryId, item_id: itemId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_DISTRIBUTED');
  });
});

describe('GET /api/distributions', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lists distributions filtered by beneficiary', async () => {
    const { admin, itemId, beneficiaryId } = await setup();
    await request(app).post('/api/distributions').set(bearer(admin)).send({ beneficiary_id: beneficiaryId, item_id: itemId });

    const res = await request(app).get(`/api/distributions?beneficiary=${beneficiaryId}`).set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.distributions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace server -- distribution.routes.test.js`
Expected: FAIL — 404s, no `/api/distributions` routes mounted.

- [ ] **Step 3: Implement it**

Create `server/src/modules/distribution/distribution.controller.js`:

```js
import * as distributionService from './distribution.service.js';
import { DistributionRecord } from './distributionRecord.model.js';

export async function createDistributionHandler(req, res) {
  const record = await distributionService.distributeItem(req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.status(201).json({ distribution: record.toSafeJSON() });
}

export async function listDistributionsHandler(req, res) {
  const filter = {};
  if (req.query.beneficiary) filter.beneficiary_id = req.query.beneficiary;
  if (req.query.camp) filter.camp_id = req.query.camp;
  if (req.query.date) {
    const start = new Date(req.query.date);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    filter.distributed_at = { $gte: start, $lt: end };
  }
  const records = await DistributionRecord.find(filter).sort({ distributed_at: -1 }).limit(100);
  res.json({ distributions: records.map((r) => r.toSafeJSON()) });
}
```

Create `server/src/modules/distribution/distribution.routes.js`:

```js
import { Router } from 'express';
import { distributeItemSchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { createDistributionHandler, listDistributionsHandler } from './distribution.controller.js';

export const distributionRouter = Router();
distributionRouter.post('/distributions', authenticate, authorize('admin', 'camp_official'), validate(distributeItemSchema), createDistributionHandler);
distributionRouter.get('/distributions', authenticate, authorize('admin', 'camp_official'), listDistributionsHandler);
```

Modify `server/src/app.js` — add the import and mount:

```js
import { distributionRouter } from './modules/distribution/distribution.routes.js';
// ...
app.use('/api', distributionRouter);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace server -- distribution.routes.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "$(cat <<'EOF'
feat: add distribution API routes

Admin and camp official can record and list distributions;
GET /distributions supports filtering by beneficiary, camp, and date
for the history screen.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Client — resource and inventory admin screens

**Files:**
- Create: `client/src/api/resources.js`
- Create: `client/src/features/admin/resources/{ResourceItemsPage.jsx,InventoryPage.jsx}`
- Modify: `client/src/App.jsx`
- Test: `client/src/features/admin/resources/{ResourceItemsPage.test.jsx,InventoryPage.test.jsx}`

**Interfaces:**
- Consumes: `GET|POST /api/resources`, `GET|POST|PATCH /api/inventory` (Task 2), `StatusBadge` (Plan 2)
- Produces: `useResourceItems()`, `useCreateResourceItem()`, `useInventory(campId?)`, `useCreateInventory()`, `useAdjustInventory()`, `<ResourceItemsPage>`, `<InventoryPage>`

- [ ] **Step 1: Write the failing tests**

Create `client/src/features/admin/resources/ResourceItemsPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResourceItemsPage } from './ResourceItemsPage.jsx';
import { api } from '../../../api/client.js';

vi.mock('../../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ResourceItemsPage /></QueryClientProvider>);
}

describe('ResourceItemsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists resource items', async () => {
    api.get.mockResolvedValue({ data: { items: [{ id: '1', name: 'Rice', category: 'food', unit: 'kg' }] } });
    renderPage();
    expect(await screen.findByText('Rice')).toBeInTheDocument();
  });

  it('submits a new item', async () => {
    api.get.mockResolvedValue({ data: { items: [] } });
    api.post.mockResolvedValue({ data: { item: { id: '2', name: 'Blankets' } } });
    renderPage();
    await screen.findByText(/no resource items yet/i);

    await userEvent.type(screen.getByLabelText(/item name/i), 'Blankets');
    await userEvent.type(screen.getByLabelText(/unit/i), 'pieces');
    await userEvent.click(screen.getByRole('button', { name: /add item/i }));

    expect(api.post).toHaveBeenCalledWith('/resources', expect.objectContaining({ name: 'Blankets', unit: 'pieces' }));
  });
});
```

Create `client/src/features/admin/resources/InventoryPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InventoryPage } from './InventoryPage.jsx';
import { api } from '../../../api/client.js';

vi.mock('../../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><InventoryPage /></QueryClientProvider>);
}

describe('InventoryPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows a low-stock badge for an entry under threshold', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/resources') return Promise.resolve({ data: { items: [{ id: 'i1', name: 'Rice', unit: 'kg' }] } });
      return Promise.resolve({
        data: { inventory: [{ id: '1', item_id: 'i1', camp_id: 'c1', remaining_qty: 10, reorder_threshold: 50, is_low_stock: true, is_near_expiry: false, is_expired: false }] },
      });
    });
    renderPage();
    expect(await screen.findByText('Rice')).toBeInTheDocument();
    expect(screen.getByText(/low stock/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace client`
Expected: FAIL — cannot resolve `./ResourceItemsPage.jsx` / `./InventoryPage.jsx`.

- [ ] **Step 3: Implement the API hooks**

Create `client/src/api/resources.js`:

```js
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useResourceItems() {
  return useQuery({ queryKey: ['resources'], queryFn: async () => (await api.get('/resources')).data.items });
}

export function useCreateResourceItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/resources', payload)).data.item,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resources'] }),
  });
}

export function useInventory(campId) {
  return useQuery({
    queryKey: ['inventory', campId],
    queryFn: async () => (await api.get('/inventory', { params: campId ? { camp_id: campId } : {} })).data.inventory,
  });
}

export function useCreateInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/inventory', payload)).data.inventory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useAdjustInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }) => (await api.patch(`/inventory/${id}`, payload)).data.inventory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
}
```

- [ ] **Step 4: Implement the pages**

Create `client/src/features/admin/resources/ResourceItemsPage.jsx`:

```jsx
import { useState } from 'react';
import { Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useResourceItems, useCreateResourceItem } from '../../../api/resources.js';

const CATEGORIES = ['food', 'medical', 'clothing', 'shelter', 'hygiene', 'other'];

export function ResourceItemsPage() {
  const { data: items = [], isLoading } = useResourceItems();
  const createItem = useCreateResourceItem();
  const [values, setValues] = useState({ name: '', category: 'food', unit: '' });
  const change = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    await createItem.mutateAsync(values);
    setValues({ name: '', category: 'food', unit: '' });
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.3fr 1fr' }, gap: 3 }}>
      <Box>
        <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>Resource catalog</Typography>
        <Stack spacing={1.5}>
          {items.map((item) => (
            <Card key={item.id}><CardContent>
              <Typography sx={{ fontWeight: 600 }}>{item.name}</Typography>
              <Typography variant="body2" color="text.secondary">{item.category} · {item.unit}</Typography>
            </CardContent></Card>
          ))}
          {!isLoading && items.length === 0 && <Typography color="text.secondary">No resource items yet.</Typography>}
        </Stack>
      </Box>
      <Card><CardContent>
        <Typography sx={{ fontWeight: 600, mb: 2 }}>Add resource item</Typography>
        <Box component="form" onSubmit={onSubmit} noValidate>
          <TextField label="Item name" value={values.name} onChange={change('name')} />
          <TextField select label="Category" value={values.category} onChange={change('category')}>
            {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </TextField>
          <TextField label="Unit" value={values.unit} onChange={change('unit')} placeholder="kg, liters, pieces…" />
          <Button type="submit" variant="contained" fullWidth disabled={createItem.isPending} sx={{ mt: 2 }}>
            {createItem.isPending ? 'Adding…' : 'Add item'}
          </Button>
        </Box>
      </CardContent></Card>
    </Box>
  );
}
```

Create `client/src/features/admin/resources/InventoryPage.jsx`:

```jsx
import { Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useResourceItems } from '../../../api/resources.js';
import { useInventory } from '../../../api/resources.js';
import { StatusBadge } from '../../../components/StatusBadge.jsx';

export function InventoryPage() {
  const { data: items = [] } = useResourceItems();
  const { data: inventory = [] } = useInventory();
  const itemName = (id) => items.find((i) => i.id === id)?.name ?? id;

  return (
    <Box>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>Inventory</Typography>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Item</TableCell><TableCell>Remaining</TableCell><TableCell>Distributed</TableCell>
              <TableCell>Threshold</TableCell><TableCell>Flags</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {inventory.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>{itemName(inv.item_id)}</TableCell>
                <TableCell>{inv.remaining_qty}</TableCell>
                <TableCell>{inv.distributed_qty}</TableCell>
                <TableCell>{inv.reorder_threshold}</TableCell>
                <TableCell>
                  {inv.is_low_stock && <StatusBadge tone="bad">Low stock</StatusBadge>}
                  {inv.is_expired && <StatusBadge tone="bad">Expired</StatusBadge>}
                  {!inv.is_expired && inv.is_near_expiry && <StatusBadge tone="warn">Near expiry</StatusBadge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace client`
Expected: PASS — 3 new tests.

- [ ] **Step 6: Wire the routes**

Modify `client/src/App.jsx` — import both pages and add routes inside the existing admin block:

```jsx
import { ResourceItemsPage } from './features/admin/resources/ResourceItemsPage.jsx';
import { InventoryPage } from './features/admin/resources/InventoryPage.jsx';
```

```jsx
<Route path="/admin/resources" element={<ResourceItemsPage />} />
<Route path="/admin/inventory" element={<InventoryPage />} />
```

- [ ] **Step 7: Commit**

```bash
git add client/
git commit -m "$(cat <<'EOF'
feat: add admin resource catalog and inventory screens

InventoryPage renders the is_low_stock/is_near_expiry/is_expired flags
the server already computes (Task 2) rather than recomputing them
client-side, so the two can never disagree.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Client — distribution rules editor

**Files:**
- Create: `client/src/api/distributionRules.js`
- Create: `client/src/features/admin/resources/DistributionRulesPage.jsx`
- Modify: `client/src/App.jsx`
- Test: `client/src/features/admin/resources/DistributionRulesPage.test.jsx`

**Interfaces:**
- Consumes: `GET|POST /api/distribution-rules` (Task 4)
- Produces: `useDistributionRules(itemId?)`, `useCreateDistributionRule()`, `<DistributionRulesPage>`

- [ ] **Step 1: Write the failing test**

Create `client/src/features/admin/resources/DistributionRulesPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DistributionRulesPage } from './DistributionRulesPage.jsx';
import { api } from '../../../api/client.js';

vi.mock('../../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DistributionRulesPage /></QueryClientProvider>);
}

describe('DistributionRulesPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists items and lets an admin configure a fixed rule', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/resources') return Promise.resolve({ data: { items: [{ id: 'i1', name: 'Rice', unit: 'kg' }] } });
      return Promise.resolve({ data: { rules: [] } });
    });
    api.post.mockResolvedValue({ data: { rule: { id: 'r1' } } });
    renderPage();

    await userEvent.click(await screen.findByLabelText(/item/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Rice' }));
    await userEvent.click(screen.getByLabelText(/mode/i));
    await userEvent.click(await screen.findByRole('option', { name: /fixed/i }));
    await userEvent.type(screen.getByLabelText(/fixed quantity/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /save rule/i }));

    expect(api.post).toHaveBeenCalledWith('/distribution-rules', expect.objectContaining({ item_id: 'i1', mode: 'fixed' }));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client`
Expected: FAIL — cannot resolve `./DistributionRulesPage.jsx`.

- [ ] **Step 3: Implement it**

Create `client/src/api/distributionRules.js`:

```js
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useDistributionRules(itemId) {
  return useQuery({
    queryKey: ['distribution-rules', itemId],
    queryFn: async () => (await api.get('/distribution-rules', { params: itemId ? { item_id: itemId } : {} })).data.rules,
    enabled: Boolean(itemId),
  });
}

export function useCreateDistributionRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/distribution-rules', payload)).data.rule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['distribution-rules'] }),
  });
}
```

Create `client/src/features/admin/resources/DistributionRulesPage.jsx`:

```jsx
import { useState } from 'react';
import { Box, Button, Card, CardContent, MenuItem, TextField, Typography } from '@mui/material';
import { useResourceItems } from '../../../api/resources.js';
import { useDistributionRules, useCreateDistributionRule } from '../../../api/distributionRules.js';

export function DistributionRulesPage() {
  const { data: items = [] } = useResourceItems();
  const [itemId, setItemId] = useState('');
  const { data: rules = [] } = useDistributionRules(itemId);
  const createRule = useCreateDistributionRule();

  const [mode, setMode] = useState('fixed');
  const [period, setPeriod] = useState('daily');
  const [fixedQty, setFixedQty] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    await createRule.mutateAsync({ item_id: itemId, mode, period, fixed_qty: mode === 'fixed' ? Number(fixedQty) : undefined });
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
      <Card><CardContent>
        <Typography sx={{ fontWeight: 600, mb: 2 }}>Configure a distribution rule</Typography>
        <Box component="form" onSubmit={onSubmit} noValidate>
          <TextField select label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            {items.map((i) => <MenuItem key={i.id} value={i.id}>{i.name}</MenuItem>)}
          </TextField>
          <TextField select label="Mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <MenuItem value="fixed">Fixed</MenuItem>
            <MenuItem value="per_head">Per head</MenuItem>
            <MenuItem value="family_band">Family band</MenuItem>
          </TextField>
          <TextField select label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <MenuItem value="daily">Daily</MenuItem>
            <MenuItem value="weekly">Weekly</MenuItem>
            <MenuItem value="once">Once</MenuItem>
          </TextField>
          {mode === 'fixed' && (
            <TextField label="Fixed quantity" value={fixedQty} onChange={(e) => setFixedQty(e.target.value)} />
          )}
          <Button type="submit" variant="contained" fullWidth disabled={!itemId || createRule.isPending} sx={{ mt: 2 }}>
            {createRule.isPending ? 'Saving…' : 'Save rule'}
          </Button>
        </Box>
      </CardContent></Card>
      <Card><CardContent>
        <Typography sx={{ fontWeight: 600, mb: 2 }}>Existing rules for this item</Typography>
        {rules.map((r) => (
          <Typography key={r.id} sx={{ py: 0.5 }}>{r.mode} · {r.period} · {r.camp_id ? 'camp override' : 'global default'}</Typography>
        ))}
        {itemId && rules.length === 0 && <Typography color="text.secondary">No rules configured yet.</Typography>}
      </CardContent></Card>
    </Box>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace client`
Expected: PASS — 1 new test.

- [ ] **Step 5: Wire the route**

Modify `client/src/App.jsx`:

```jsx
import { DistributionRulesPage } from './features/admin/resources/DistributionRulesPage.jsx';
```

```jsx
<Route path="/admin/distribution-rules" element={<DistributionRulesPage />} />
```

- [ ] **Step 6: Commit**

```bash
git add client/
git commit -m "$(cat <<'EOF'
feat: add the distribution rules editor

Admin picks an item, a mode (fixed/per_head/family_band), and a period,
matching the hybrid engine Task 4 built server-side. Existing rules for
the selected item are listed, distinguishing a camp-specific override
from the global default (camp_id: null).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Client — distribution recording and history

**Files:**
- Create: `client/src/api/distributions.js`
- Create: `client/src/features/distribution/{DistributePage.jsx,DistributionHistoryPage.jsx}`
- Modify: `client/src/App.jsx`
- Test: `client/src/features/distribution/{DistributePage.test.jsx,DistributionHistoryPage.test.jsx}`

**Interfaces:**
- Consumes: `POST|GET /api/distributions` (Task 7), `GET /api/registrations/:code` (Plan 3)
- Produces: `useDistributeItem()`, `useDistributions(filters)`, `<DistributePage>`, `<DistributionHistoryPage>`

- [ ] **Step 1: Write the failing tests**

Create `client/src/features/distribution/DistributePage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DistributePage } from './DistributePage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DistributePage /></QueryClientProvider>);
}

describe('DistributePage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('looks up a beneficiary by code then records a distribution', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/resources') return Promise.resolve({ data: { items: [{ id: 'i1', name: 'Rice', unit: 'kg' }] } });
      if (url.startsWith('/registrations/')) {
        return Promise.resolve({ data: { registration: { beneficiary: { id: 'b1', beneficiary_code: 'BEN-1001', status: 'active' }, members: [] } } });
      }
      return Promise.resolve({ data: {} });
    });
    api.post.mockResolvedValue({ data: { distribution: { id: 'd1', quantity: 5 } } });
    renderPage();

    await userEvent.type(screen.getByLabelText(/beneficiary code/i), 'BEN-1001');
    await userEvent.click(screen.getByRole('button', { name: /find/i }));
    expect(await screen.findByText('BEN-1001')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/item/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Rice' }));
    await userEvent.click(screen.getByRole('button', { name: /distribute/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/distributions', { beneficiary_id: 'b1', item_id: 'i1' }));
  });
});
```

Create `client/src/features/distribution/DistributionHistoryPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DistributionHistoryPage } from './DistributionHistoryPage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DistributionHistoryPage /></QueryClientProvider>);
}

describe('DistributionHistoryPage', () => {
  it('lists past distributions', async () => {
    api.get.mockResolvedValue({ data: { distributions: [{ id: 'd1', item_id: 'i1', quantity: 5, distributed_at: '2026-08-12T10:00:00Z' }] } });
    renderPage();
    expect(await screen.findByText(/quantity: 5/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace client`
Expected: FAIL — cannot resolve `./DistributePage.jsx` / `./DistributionHistoryPage.jsx`.

- [ ] **Step 3: Implement the API hooks**

Create `client/src/api/distributions.js`:

```js
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useDistributeItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/distributions', payload)).data.distribution,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['distributions'] }),
  });
}

export function useDistributions(filters = {}) {
  return useQuery({
    queryKey: ['distributions', filters],
    queryFn: async () => (await api.get('/distributions', { params: filters })).data.distributions,
  });
}
```

- [ ] **Step 4: Implement the pages**

Create `client/src/features/distribution/DistributePage.jsx`:

```jsx
import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, MenuItem, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useResourceItems } from '../../api/resources.js';
import { useDistributeItem } from '../../api/distributions.js';

export function DistributePage() {
  const [code, setCode] = useState('');
  const [lookupCode, setLookupCode] = useState(null);
  const { data: items = [] } = useResourceItems();
  const [itemId, setItemId] = useState('');
  const distribute = useDistributeItem();
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const { data: registration } = useQuery({
    queryKey: ['registrations', 'lookup', lookupCode],
    queryFn: async () => (await api.get(`/registrations/${lookupCode}`)).data.registration,
    enabled: Boolean(lookupCode),
  });

  async function onDistribute() {
    setError(null);
    setSuccess(null);
    try {
      const result = await distribute.mutateAsync({ beneficiary_id: registration.beneficiary.id, item_id: itemId });
      setSuccess(`Distributed ${result.quantity} unit(s).`);
    } catch (err) {
      setError(err?.response?.data?.error?.message ?? 'Could not record the distribution.');
    }
  }

  return (
    <Box sx={{ maxWidth: 480 }}>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>Record a distribution</Typography>
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <TextField label="Beneficiary code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button variant="outlined" onClick={() => setLookupCode(code)}>Find</Button>
      </Box>

      {registration && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography sx={{ fontWeight: 600 }}>{registration.beneficiary.beneficiary_code}</Typography>
            <Typography variant="body2" color="text.secondary">{registration.beneficiary.status}</Typography>

            <TextField select label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)} sx={{ mt: 2 }}>
              {items.map((i) => <MenuItem key={i.id} value={i.id}>{i.name}</MenuItem>)}
            </TextField>
            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mt: 2 }}>{success}</Alert>}
            <Button variant="contained" fullWidth disabled={!itemId || distribute.isPending} onClick={onDistribute} sx={{ mt: 2 }}>
              {distribute.isPending ? 'Distributing…' : 'Distribute'}
            </Button>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
```

Create `client/src/features/distribution/DistributionHistoryPage.jsx`:

```jsx
import { Box, Typography } from '@mui/material';
import { useDistributions } from '../../api/distributions.js';

export function DistributionHistoryPage() {
  const { data: distributions = [] } = useDistributions();

  return (
    <Box>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>Distribution history</Typography>
      {distributions.map((d) => (
        <Typography key={d.id} sx={{ py: 0.5 }}>
          {new Date(d.distributed_at).toLocaleString()} — Quantity: {d.quantity}
        </Typography>
      ))}
      {distributions.length === 0 && <Typography color="text.secondary">No distributions recorded yet.</Typography>}
    </Box>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace client`
Expected: PASS — 2 new tests.

- [ ] **Step 6: Wire the routes**

Modify `client/src/App.jsx` — add inside the existing `camp_official`/`admin` block:

```jsx
import { DistributePage } from './features/distribution/DistributePage.jsx';
import { DistributionHistoryPage } from './features/distribution/DistributionHistoryPage.jsx';
```

```jsx
<Route path="/official/distribute" element={<DistributePage />} />
<Route path="/official/distributions" element={<DistributionHistoryPage />} />
```

- [ ] **Step 7: Commit**

```bash
git add client/
git commit -m "$(cat <<'EOF'
feat: add distribution recording and history screens

DistributePage looks a family up by Beneficiary ID, picks an item, and
distributes — the same code path an official uses. Server-side errors
(already distributed today, insufficient stock, not verified) surface
as-is rather than being pre-guessed client-side, so the message the
official sees always matches what actually happened.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Client — volunteer task assignment and duty dashboard

**Files:**
- Create: `client/src/api/volunteers.js`
- Create: `client/src/features/official/{VolunteerAssignPage.jsx,VolunteerDutyDashboard.jsx}`
- Modify: `client/src/App.jsx`
- Test: `client/src/features/official/{VolunteerAssignPage.test.jsx,VolunteerDutyDashboard.test.jsx}`

**Interfaces:**
- Consumes: `POST /api/volunteers/:memberId/{assign,complete}` (Task 5), `GET /api/registrations` search (Plan 3)
- Produces: `useAssignVolunteerDuty()`, `useCompleteVolunteerDuty()`, `<VolunteerAssignPage>`, `<VolunteerDutyDashboard>`

- [ ] **Step 1: Write the failing tests**

Create `client/src/features/official/VolunteerAssignPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VolunteerAssignPage } from './VolunteerAssignPage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><VolunteerAssignPage /></QueryClientProvider>);
}

describe('VolunteerAssignPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('searches and assigns a task to an accepted volunteer', async () => {
    api.get.mockResolvedValue({
      data: {
        registrations: [{
          beneficiary: { id: 'b1', beneficiary_code: 'BEN-1001' },
          members: [{ id: 'm1', name: 'Meena Devi', volunteer_status: 'accepted' }],
        }],
      },
    });
    api.post.mockResolvedValue({ data: { member: { id: 'm1', volunteer_status: 'active' } } });
    renderPage();

    await userEvent.type(screen.getByLabelText(/search by code, name, or mobile/i), 'Meena');
    await screen.findByText('Meena Devi');
    await userEvent.type(screen.getByLabelText(/task/i), 'Food distribution');
    await userEvent.type(screen.getByLabelText(/shift/i), 'Morning');
    await userEvent.click(screen.getByRole('button', { name: /assign/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/volunteers/m1/assign', { task: 'Food distribution', shift: 'Morning' }));
  });
});
```

Create `client/src/features/official/VolunteerDutyDashboard.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VolunteerDutyDashboard } from './VolunteerDutyDashboard.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><VolunteerDutyDashboard /></QueryClientProvider>);
}

describe('VolunteerDutyDashboard', () => {
  it('shows active volunteers with their task and shift', async () => {
    api.get.mockResolvedValue({
      data: { registrations: [{ beneficiary: { id: 'b1' }, members: [{ id: 'm1', name: 'Meena Devi', volunteer_status: 'active', volunteer_task: 'Food distribution', volunteer_shift: 'Morning' }] }] },
    });
    renderPage();
    expect(await screen.findByText('Meena Devi')).toBeInTheDocument();
    expect(screen.getByText(/food distribution/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace client`
Expected: FAIL — cannot resolve `./VolunteerAssignPage.jsx` / `./VolunteerDutyDashboard.jsx`.

- [ ] **Step 3: Implement it**

Create `client/src/api/volunteers.js`:

```js
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useAssignVolunteerDuty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, task, shift }) => (await api.post(`/volunteers/${memberId}/assign`, { task, shift })).data.member,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registrations'] }),
  });
}

export function useCompleteVolunteerDuty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, hours }) => (await api.post(`/volunteers/${memberId}/complete`, { hours })).data.member,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registrations'] }),
  });
}
```

Create `client/src/features/official/VolunteerAssignPage.jsx`:

```jsx
import { useState } from 'react';
import { Box, Button, Card, CardContent, TextField, Typography } from '@mui/material';
import { useSearchRegistrations } from '../../api/registration.js';
import { useAssignVolunteerDuty } from '../../api/volunteers.js';

export function VolunteerAssignPage() {
  const [search, setSearch] = useState('');
  const { data: registrations = [] } = useSearchRegistrations(search);
  const assign = useAssignVolunteerDuty();
  const [task, setTask] = useState('');
  const [shift, setShift] = useState('');

  return (
    <Box>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>Assign volunteer duty</Typography>
      <TextField label="Search by code, name, or mobile" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 2, minWidth: 320 }} />
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <TextField label="Task" value={task} onChange={(e) => setTask(e.target.value)} />
        <TextField label="Shift" value={shift} onChange={(e) => setShift(e.target.value)} />
      </Box>

      {registrations.map(({ beneficiary, members }) => (
        <Card key={beneficiary.id} sx={{ mb: 2 }}>
          <CardContent>
            {members.filter((m) => m.volunteer_status === 'accepted' || m.volunteer_status === 'active').map((m) => (
              <Box key={m.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1 }}>
                <Typography>{m.name}</Typography>
                <Button size="small" variant="outlined" disabled={!task || !shift || assign.isPending}
                  onClick={() => assign.mutate({ memberId: m.id, task, shift })}>
                  Assign
                </Button>
              </Box>
            ))}
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}
```

Create `client/src/features/official/VolunteerDutyDashboard.jsx`:

```jsx
import { Box, Button, Card, CardContent, Typography } from '@mui/material';
import { useSearchRegistrations } from '../../api/registration.js';
import { useCompleteVolunteerDuty } from '../../api/volunteers.js';

export function VolunteerDutyDashboard() {
  // A blank search backend-side would be wasteful; a dedicated "list active
  // volunteers" endpoint is a reasonable Plan 5 addition. For M1, an admin
  // or official searches by camp/name the same way check-in does.
  const { data: registrations = [] } = useSearchRegistrations('BEN-');
  const complete = useCompleteVolunteerDuty();

  const activeVolunteers = registrations
    .flatMap((r) => r.members.map((m) => ({ ...m, beneficiary: r.beneficiary })))
    .filter((m) => m.volunteer_status === 'active');

  return (
    <Box>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>Active volunteer duties</Typography>
      {activeVolunteers.map((m) => (
        <Card key={m.id} sx={{ mb: 1.5 }}>
          <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography sx={{ fontWeight: 600 }}>{m.name}</Typography>
              <Typography variant="body2" color="text.secondary">{m.volunteer_task} · {m.volunteer_shift}</Typography>
            </Box>
            <Button size="small" variant="outlined" onClick={() => complete.mutate({ memberId: m.id, hours: 4 })}>
              Mark completed (4h)
            </Button>
          </CardContent>
        </Card>
      ))}
      {activeVolunteers.length === 0 && <Typography color="text.secondary">No active volunteer duties.</Typography>}
    </Box>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace client`
Expected: PASS — 2 new tests.

- [ ] **Step 5: Wire the routes**

Modify `client/src/App.jsx`:

```jsx
import { VolunteerAssignPage } from './features/official/VolunteerAssignPage.jsx';
import { VolunteerDutyDashboard } from './features/official/VolunteerDutyDashboard.jsx';
```

```jsx
<Route path="/official/volunteers/assign" element={<VolunteerAssignPage />} />
<Route path="/official/volunteers/duties" element={<VolunteerDutyDashboard />} />
```

- [ ] **Step 6: Commit**

```bash
git add client/
git commit -m "$(cat <<'EOF'
feat: add volunteer task assignment and duty dashboard screens

VolunteerDutyDashboard's "list active volunteers" is a search-by-prefix
workaround rather than a dedicated endpoint — flagged as a reasonable
follow-up, not hidden as if it were the real thing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Admin dashboard shell, notification centre, and role nav

**Files:**
- Create: `client/src/api/dashboard.js`
- Create: `client/src/features/admin/DashboardPage.jsx`
- Create: `client/src/api/notifications.js`
- Create: `client/src/components/NotificationBell.jsx`
- Modify: `client/src/App.jsx`, `client/src/layouts/RoleLayout.jsx`
- Create: `server/src/modules/dashboard/dashboard.service.js`, `server/src/modules/dashboard/dashboard.controller.js`, `server/src/modules/dashboard/dashboard.routes.js`
- Modify: `server/src/app.js`
- Test: `server/src/modules/dashboard/dashboard.test.js`, `client/src/features/admin/DashboardPage.test.jsx`

**Interfaces:**
- Consumes: `Camp` (Plan 2), `Beneficiary`/`RegistrationMember` (Plan 3), `Inventory` (Task 1), `AffectedArea` (Plan 2)
- Produces: `getDashboardSummary(): Promise<object>`; `GET /api/dashboard/summary`; `useDashboardSummary()`, `<DashboardPage>`, `useNotifications()`, `<NotificationBell>`

**This closes the gap flagged after Plan 3.** Spec §7.1/§6.16 always scoped an M1 admin dashboard covering **Camps, Beneficiaries, Volunteers, Inventory**, plus Flood Monitoring limited to affected-area counts — every figure computed by aggregation, never manually entered (spec §18). All the underlying data has existed since Plan 3 (Camps/Beneficiaries/Volunteers) and Task 1 of this plan (Inventory); this task is the read-only shell over it, not new business logic. It also finally links `/admin` and `/official` to their real screens instead of being dead ends.

- [ ] **Step 1: Write the failing server test**

Create `server/src/modules/dashboard/dashboard.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9800000000 + Math.floor(Math.random() * 199999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active', ...over,
  });
}
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

const campBody = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7, flood_severity: 'high',
  beneficiary_capacity: 10, volunteer_capacity: 5, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

describe('GET /api/dashboard/summary', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('returns computed camp, beneficiary, and volunteer counts', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const campId = campRes.body.camp.id;
    const person = await makeUser('affected_person');
    await request(app).post('/api/registrations').set(bearer(person)).send({
      camp_id: campId,
      members: [{ name: 'Meena Devi', age: 34, gender: 'female', aadhaar: '234567890688', mobile: '9876543210', address: '12 River Road', wants_to_volunteer: true }],
    });

    const res = await request(app).get('/api/dashboard/summary').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.camps.total).toBe(1);
    expect(res.body.beneficiaries.total_registered).toBe(1);
    expect(res.body.volunteers.accepted).toBe(1);
  });

  it('refuses a donor', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).get('/api/dashboard/summary').set(bearer(donor));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace server -- dashboard.test.js`
Expected: FAIL — 404, no `/api/dashboard/summary` route mounted.

- [ ] **Step 3: Implement the server side**

Create `server/src/modules/dashboard/dashboard.service.js`:

```js
import { Camp } from '../camps/camp.model.js';
import { Beneficiary } from '../intake/beneficiary.model.js';
import { RegistrationMember } from '../intake/registrationMember.model.js';
import { Inventory } from '../resources/inventory.model.js';
import { AffectedArea } from '../areas/affectedArea.model.js';
import { isLowStock, isNearExpiry, isExpired } from '@frp/shared';

/**
 * Every figure here is computed by aggregation over stored data, never
 * manually entered (spec section 18). Registered vs. checked-in counts
 * are kept as separate, clearly labelled figures (spec section 6.16),
 * not merged into one number.
 */
export async function getDashboardSummary() {
  const [campStatusCounts, campTotal] = await Promise.all([
    Camp.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Camp.countDocuments(),
  ]);

  const [beneficiaryTotal, checkedInCount, priorityCount] = await Promise.all([
    Beneficiary.countDocuments(),
    RegistrationMember.countDocuments({ checkin_status: 'checked_in' }),
    RegistrationMember.countDocuments({ priority_level: 'high' }),
  ]);

  const [volunteerAccepted, volunteerActive, volunteerCompleted] = await Promise.all([
    RegistrationMember.countDocuments({ volunteer_status: 'accepted' }),
    RegistrationMember.countDocuments({ volunteer_status: 'active' }),
    RegistrationMember.countDocuments({ volunteer_status: 'completed' }),
  ]);

  const inventoryEntries = await Inventory.find();
  const lowStockCount = inventoryEntries.filter((i) => isLowStock(i)).length;
  const nearExpiryCount = inventoryEntries.filter((i) => !isExpired(i.expiry_date) && isNearExpiry(i.expiry_date)).length;
  const expiredCount = inventoryEntries.filter((i) => isExpired(i.expiry_date)).length;

  const affectedAreaCount = await AffectedArea.countDocuments();

  return {
    camps: {
      total: campTotal,
      by_status: Object.fromEntries(campStatusCounts.map((c) => [c._id, c.count])),
    },
    beneficiaries: {
      total_registered: beneficiaryTotal,
      total_checked_in: checkedInCount,
      high_priority: priorityCount,
    },
    volunteers: {
      accepted: volunteerAccepted,
      active: volunteerActive,
      completed: volunteerCompleted,
    },
    inventory: {
      low_stock: lowStockCount,
      near_expiry: nearExpiryCount,
      expired: expiredCount,
    },
    flood_monitoring: {
      affected_areas: affectedAreaCount,
    },
  };
}
```

Create `server/src/modules/dashboard/dashboard.controller.js`:

```js
import { getDashboardSummary } from './dashboard.service.js';

export async function getDashboardSummaryHandler(req, res) {
  res.json(await getDashboardSummary());
}
```

Create `server/src/modules/dashboard/dashboard.routes.js`:

```js
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { getDashboardSummaryHandler } from './dashboard.controller.js';

export const dashboardRouter = Router();
dashboardRouter.get('/dashboard/summary', authenticate, authorize('admin'), getDashboardSummaryHandler);
```

Modify `server/src/app.js` — add the import and mount:

```js
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
// ...
app.use('/api', dashboardRouter);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace server -- dashboard.test.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Write the failing client test**

Create `client/src/features/admin/DashboardPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardPage } from './DashboardPage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><DashboardPage /></MemoryRouter></QueryClientProvider>);
}

describe('DashboardPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows registered vs checked-in as separate figures', async () => {
    api.get.mockResolvedValue({
      data: {
        camps: { total: 3, by_status: { open: 2, full: 1 } },
        beneficiaries: { total_registered: 40, total_checked_in: 25, high_priority: 6 },
        volunteers: { accepted: 5, active: 2, completed: 1 },
        inventory: { low_stock: 2, near_expiry: 1, expired: 0 },
        flood_monitoring: { affected_areas: 4 },
      },
    });
    renderPage();
    expect(await screen.findByText('40')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test --workspace client`
Expected: FAIL — cannot resolve `./DashboardPage.jsx`.

- [ ] **Step 7: Implement the client side**

Create `client/src/api/dashboard.js`:

```js
import { useQuery } from '@tanstack/react-query';
import { api } from './client.js';

export function useDashboardSummary() {
  return useQuery({ queryKey: ['dashboard', 'summary'], queryFn: async () => (await api.get('/dashboard/summary')).data });
}
```

Create `client/src/api/notifications.js`:

```js
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useNotifications() {
  return useQuery({ queryKey: ['notifications'], queryFn: async () => (await api.get('/notifications')).data.notifications });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => (await api.post(`/notifications/${id}/read`)).data.notification,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
```

Create `client/src/components/NotificationBell.jsx`:

```jsx
import { useState } from 'react';
import { Badge, Box, IconButton, Menu, MenuItem, Typography } from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { useNotifications, useMarkNotificationRead } from '../api/notifications.js';

export function NotificationBell() {
  const { data: notifications = [] } = useNotifications();
  const markRead = useMarkNotificationRead();
  const [anchorEl, setAnchorEl] = useState(null);
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <Box>
      <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} aria-label="notifications">
        <Badge badgeContent={unreadCount} color="error"><NotificationsIcon /></Badge>
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {notifications.length === 0 && <MenuItem disabled>No notifications</MenuItem>}
        {notifications.map((n) => (
          <MenuItem key={n.id} onClick={() => markRead.mutate(n.id)} sx={{ opacity: n.read ? 0.5 : 1 }}>
            <Typography variant="body2">{n.message}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
```

Create `client/src/features/admin/DashboardPage.jsx`:

```jsx
import { Box, Card, CardContent, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useDashboardSummary } from '../../api/dashboard.js';

function StatCard({ label, value, to }) {
  return (
    <Card component={to ? RouterLink : 'div'} to={to} sx={{ textDecoration: 'none', display: 'block' }}>
      <CardContent>
        <Typography variant="h4" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>{value}</Typography>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { data } = useDashboardSummary();
  if (!data) return null;

  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 2 };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 3 }}>Administrator dashboard</Typography>

      <Typography sx={{ fontWeight: 600, mb: 1.5 }}>Camps</Typography>
      <Box sx={{ ...grid, mb: 3 }}>
        <StatCard label="Total camps" value={data.camps.total} to="/admin/camps" />
        <StatCard label="Open" value={data.camps.by_status.open ?? 0} to="/admin/camps" />
        <StatCard label="Full" value={data.camps.by_status.full ?? 0} to="/admin/camps" />
      </Box>

      <Typography sx={{ fontWeight: 600, mb: 1.5 }}>Beneficiaries</Typography>
      <Box sx={{ ...grid, mb: 3 }}>
        <StatCard label="Registered" value={data.beneficiaries.total_registered} />
        <StatCard label="Checked in" value={data.beneficiaries.total_checked_in} />
        <StatCard label="High priority" value={data.beneficiaries.high_priority} />
      </Box>

      <Typography sx={{ fontWeight: 600, mb: 1.5 }}>Volunteers</Typography>
      <Box sx={{ ...grid, mb: 3 }}>
        <StatCard label="Accepted" value={data.volunteers.accepted} />
        <StatCard label="On active duty" value={data.volunteers.active} to="/official/volunteers/duties" />
        <StatCard label="Completed" value={data.volunteers.completed} />
      </Box>

      <Typography sx={{ fontWeight: 600, mb: 1.5 }}>Inventory</Typography>
      <Box sx={{ ...grid, mb: 3 }}>
        <StatCard label="Low stock" value={data.inventory.low_stock} to="/admin/inventory" />
        <StatCard label="Near expiry" value={data.inventory.near_expiry} to="/admin/inventory" />
        <StatCard label="Expired" value={data.inventory.expired} to="/admin/inventory" />
      </Box>

      <Typography sx={{ fontWeight: 600, mb: 1.5 }}>Flood monitoring</Typography>
      <Box sx={grid}>
        <StatCard label="Affected areas" value={data.flood_monitoring.affected_areas} to="/admin/areas" />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test --workspace client`
Expected: PASS — 1 new test.

- [ ] **Step 9: Wire the dashboard route and add role nav**

Modify `client/src/App.jsx` — replace the `/admin` placeholder:

```jsx
import { DashboardPage } from './features/admin/DashboardPage.jsx';
```

```jsx
<Route path="/admin" element={<DashboardPage />} />
```

Add distribution/volunteer routes for camp officials that Task 10/11 didn't already add if missing, and give `/official` a real landing instead of the placeholder — replace it with a small inline links list (not a new file; keep `Placeholder` for genuinely unbuilt screens only):

```jsx
<Route path="/official" element={(
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 1 }}>Camp official</Typography>
    <Button component={RouterLink} to="/official/checkin" variant="outlined">Check-in</Button>
    <Button component={RouterLink} to="/official/distribute" variant="outlined">Distribute</Button>
    <Button component={RouterLink} to="/official/distributions" variant="outlined">Distribution history</Button>
    <Button component={RouterLink} to="/official/volunteers/assign" variant="outlined">Assign volunteer duty</Button>
    <Button component={RouterLink} to="/official/volunteers/duties" variant="outlined">Active volunteer duties</Button>
  </Box>
)} />
```

(Add `Button`, `Typography` to the existing MUI import line, and `Link as RouterLink` is already imported for `BrowserRouter`'s sibling exports — add it to the `react-router-dom` import if not already present.)

Modify `client/src/layouts/RoleLayout.jsx` — add `<NotificationBell />` to the top chrome for `admin`/`camp_official` roles (read the file first to match its existing structure before editing; insert the import and the component next to whatever renders the user's name/logout button).

- [ ] **Step 10: Commit**

```bash
git add client/ server/
git commit -m "$(cat <<'EOF'
feat: add the M1 admin dashboard shell, notification bell, and role nav

Closes the gap flagged after Plan 3: /admin and /official were
placeholders even though their real screens already existed. The
dashboard covers exactly the areas spec section 7.1 scoped for M1 —
Camps, Beneficiaries, Volunteers, Inventory, Flood Monitoring limited
to affected-area counts — with registered-vs-checked-in kept as
separate, clearly labelled figures per section 6.16, not merged into
one number. Every figure is a live aggregation over Plan 2/3/4 data,
nothing manually entered (section 18).

/official now links to every screen a camp official actually has
instead of being a dead end.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Wire remaining routes and verify against slices 8–9

**Files:**
- Modify: `client/src/App.jsx` (if any Task 8–11 routes were missed)
- Create: `docs/superpowers/plans/2026-08-12-m1-plan4-verification.md`

**Interfaces:**
- Consumes: everything from Tasks 1–12
- Produces: a written verification record

**"Done when" from spec §10:** slice 8 — "admin configures a rice rule; stock visible with alerts"; slice 9 — "stock drops on distribution; same-day repeat blocked." Also the final Milestone-1-wide pass spec §10 calls for: "a final pass verifies Milestone 1 against every applicable line of §16 Acceptance Criteria" — this task's manual checks fold that in for the Relief Ops slice; a full §16 pass across all four plans is worth a dedicated read-through at the end, noted in this task's write-up.

- [ ] **Step 1: Run the whole suite and record the count**

Run: `npm test`
Expected: PASS, zero failures. Record the count.

- [ ] **Step 2: Start the real stack and walk the manual checks**

```bash
npm run dev
```

Confirm each, recording the result:

1. Admin creates a resource item and stocks a camp with it (`/admin/resources`, `/admin/inventory`) → visible in `GET /api/inventory?camp_id=`.
2. Admin configures a fixed-mode rice rule (`/admin/distribution-rules`) → `GET /api/distribution-rules?item_id=` shows it.
3. Admin or official distributes the item to a checked-in beneficiary (`/official/distribute`) → stock's `remaining_qty` drops by exactly the ration amount; `distributed_qty` rises by the same.
4. The same beneficiary + item is distributed again the same day → `409 ALREADY_DISTRIBUTED`.
5. Distributing to a beneficiary with zero checked-in members, no override → `409 NOT_VERIFIED`; with an `override_reason` → succeeds, and the reason is visible in `audit_logs`.
6. Lower a camp's inventory below its `reorder_threshold` (via `PATCH /api/inventory/:id`) → a `low_stock` notification appears for the admin account (`GET /api/notifications`).
7. A family with an accepted volunteer gets a task/shift assigned (`/official/volunteers/assign`) → `volunteer_status` becomes `active`; marking it complete moves it to `completed` with hours logged.
8. `/admin` now shows live Camps/Beneficiaries/Volunteers/Inventory/Flood-monitoring figures, matching direct API totals; `/official` links to every one of its screens instead of being empty.
9. `POST /api/distributions` as a donor → `403`.

- [ ] **Step 3: Write the verification record**

Create `docs/superpowers/plans/2026-08-12-m1-plan4-verification.md` with: date, test count, each of the nine checks with PASS/FAIL and evidence, and any defect found with its follow-up. Note whether a full spec §16 read-through across all four plans is still outstanding (it is, unless done as part of this task) and, if so, flag it as the next piece of work before Milestone 1 is declared fully done.

- [ ] **Step 4: Commit**

```bash
git add client/ docs/
git commit -m "$(cat <<'EOF'
docs: record Plan 4 verification against slices 8-9 acceptance criteria

Manual checks against spec section 10's "done when" ran against the
real server and live Atlas cluster: configuring a resource item and
stocking a camp, configuring a distribution rule, distributing to a
checked-in beneficiary with stock dropping by exactly the ration
amount, a same-day repeat blocked, an unverified beneficiary blocked
without an override and permitted with one (audited), a low-stock
notification firing, a volunteer duty assigned and completed, the
admin dashboard showing live aggregated figures, and donor role
enforcement on the distribution route.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage.** §3.1 (`calcRation`) → Task 4. §5.4 (distribution transaction, insert-first ordering, verification policy) → Task 6. §6.8 (low-stock/expiry) → Tasks 1, 3. §6.16/§7.1 (admin dashboard scope, registered-vs-checked-in as separate figures) → Task 12. §18 (every figure computed) → Task 12's aggregation-only design. §9 (concurrency race tests) → Tasks 6's concurrent-distribution test, matching Plan 2/3's pattern. §10 slices 8–9's "done when" → Task 13. The `volunteers/` module (duty assignment) → Task 5, extending Plan 3's `intake/` rather than a new collection, per the module-ownership rule.

**Deferred, by design:** `VolunteerDutyDashboard`'s "list active volunteers" is a search-by-prefix workaround (flagged inline in Task 11), not a dedicated aggregation endpoint — a reasonable Plan 5 addition once the shape of "who's on duty right now" needs to scale past what a `BEN-` prefix search covers. Decrypting Aadhaar, camp-detail/edit UI, and a public status-lookup screen remain deferred from Plans 2–3, unchanged by this plan. Complaints/SOS, donors/finance, and AI prediction (Milestone 2, Groups E/F/G) are untouched.

**Type consistency check.** `distributeItem`'s error codes (`NOT_VERIFIED`, `ALREADY_DISTRIBUTED`, `INSUFFICIENT_STOCK`, `NOT_ELIGIBLE`) are added to `ERROR_CODES` in Task 6 the same way Plan 3 added `DUPLICATE_AADHAAR`/`CAMP_FULL`. `Inventory.toSafeJSON()`'s field names (`remaining_qty`, `distributed_qty`, `reorder_threshold`, `expiry_date`) match what `InventoryPage.jsx`, `dashboard.service.js`, and the verification doc's manual checks all read. `calcRation`'s `members` parameter is always the array of `RegistrationMember`-shaped objects (`is_pregnant`, `has_disability`, `priority_tags`) in both the shared test fixtures and `distribution.service.js`'s real call site.

**Known simplification to flag:** `getDashboardSummary()` runs several sequential/parallel `countDocuments()`/`aggregate()` calls rather than one combined pipeline — clearer to read and modify per-area as later plans add Finance/Emergency/AI, at the cost of more round-trips than a single aggregation would need. Acceptable at M1's data volume; worth revisiting only if the dashboard becomes slow in practice.
