# Flood Relief Portal — Plan 2: Affected Areas & Camps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Admin record flood-affected areas and create camps with the full §6.3 field set, and let any signed-in affected person or donor see those camps live on the landing page — occupancy updating over Socket.IO as it changes.

**Architecture:** Two new server modules, `areas/` and `camps/`, following Plan 1's ownership rule — each owns its collections and exposes a service; nothing outside a module touches its model directly. Camp occupancy uses the same atomic `findOneAndUpdate` compare-and-swap pattern spec §5.3 mandates, guarded now even though nothing increments it until Plan 3's intake exists — the guard is camp-owned infrastructure, not intake-owned. Socket.IO is introduced here (spec §7.3): camp mutations emit `camp:occupancy`, and the client invalidates the `camps` query key rather than patching state directly, so live updates travel the same code path as an ordinary fetch.

**Tech Stack:** Everything from Plan 1, plus `socket.io` (server) and `socket.io-client` (client).

**Spec:** `docs/superpowers/specs/2026-08-12-flood-relief-portal-m1-design.md`
**Covers:** Milestone 1, slices 3–4 (Group B: Affected Areas & Camps).
**Builds on:** Plan 1 (`feature/plan1-foundation-and-auth`, merged/kept — `authenticate`, `authorize`, `recordAudit`, `withTransaction`, `AppError`, `validate`, the theme, and `AuthProvider`/`RequireAuth`/`RoleLayout` are all in place and unchanged by this plan).

## Global Constraints

- **ESM everywhere, TDD always, uniform error envelope, `authorize(...roles)` on every protected route** — carried forward from Plan 1 unchanged.
- **Module ownership rule (spec §3.2):** `areas/` owns `affected_areas` and `flood_alerts`; `camps/` owns `camps`. Neither reaches into the other's model — only through its service.
- **Camp occupancy never set directly by a request body.** `beneficiaries_accepted` and `volunteers_accepted` only change through the guarded atomic update in `camps.service.js`; requirements §18 requires every dashboard figure to be computed, not manually entered, and that starts with these two counters.
- **Camp status is computed, not free-typed**, except for two explicit admin actions (`temporarily_close`, `reopen`) — a declared judgment call, documented in Task 3, since §6.3 lists Status as a field without saying who sets Open/Nearly Full/Full.
- **Socket.IO events invalidate query keys, never push state directly** (spec §7.3).
- **Commit after every task**, trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

## File Structure

```
FloodReliefCamp/
├─ shared/src/schemas/
│  ├─ area.schema.js                   createAreaSchema, floodAlertSchema
│  └─ camp.schema.js                   createCampSchema, updateCampSchema
├─ server/src/
│  ├─ core/
│  │  ├─ socket.js                     initSocket(httpServer), emitCampOccupancy(), getIO()
│  │  └─ socket.test.js
│  ├─ modules/
│  │  ├─ areas/
│  │  │  ├─ affectedArea.model.js
│  │  │  ├─ floodAlert.model.js
│  │  │  ├─ areas.service.js
│  │  │  ├─ areas.controller.js
│  │  │  ├─ areas.routes.js
│  │  │  └─ areas.test.js
│  │  └─ camps/
│  │     ├─ camp.model.js
│  │     ├─ camp.model.test.js
│  │     ├─ camp.status.js             deriveCampStatus() — pure function
│  │     ├─ camp.status.test.js
│  │     ├─ camps.service.js
│  │     ├─ camps.service.test.js
│  │     ├─ camps.controller.js
│  │     ├─ camps.routes.js
│  │     └─ camps.test.js              route-level integration tests
│  └─ server.js                        modified: http.Server + initSocket(), replacing app.listen()
└─ client/src/
   ├─ api/
   │  ├─ socket.js                     socket.io-client instance, useLiveCampUpdates()
   │  ├─ areas.js                      useAreas, useActiveAlerts, useCreateArea
   │  └─ camps.js                      useCamps, useCamp, useCreateCamp
   ├─ components/
   │  └─ StatusBadge.jsx               shared colored-pill badge, tone-keyed
   ├─ features/
   │  ├─ admin/
   │  │  ├─ areas/AreasPage.jsx
   │  │  └─ camps/{CampsListPage.jsx,CreateCampPage.jsx}
   │  └─ landing/LandingPage.jsx
   └─ App.jsx                          modified: LandingPage + admin routes replace Plan 1's placeholders
```

---

### Task 1: Camp status derivation (pure function)

**Files:**
- Create: `server/src/modules/camps/camp.status.js`
- Test: `server/src/modules/camps/camp.status.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `deriveCampStatus({ beneficiaries_accepted, beneficiary_capacity, admin_override }): 'open'|'nearly_full'|'full'|'temporarily_closed'|'closed'`

**The judgment call this task makes explicit:** spec §6.3 lists Status as a
field but does not say who sets Open/Nearly Full/Full — those three clearly
track occupancy, which requirements §18 says must be computed, never
manually entered. `Temporarily Closed` and `Closed` are lifecycle actions
only Admin can take (spec §6.3: "Admin can create, view, edit, activate/
deactivate, close"). So status is computed from occupancy **unless** an
admin override is in force, and the override always wins. Threshold: 100%
occupancy is `full`; 85% or above is `nearly_full`; the exact number is a
judgment call — flag it if the real deployment needs a different value,
it is one constant to change.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { deriveCampStatus } from './camp.status.js';

describe('deriveCampStatus', () => {
  it('is open below the nearly-full threshold', () => {
    expect(deriveCampStatus({ beneficiaries_accepted: 50, beneficiary_capacity: 100 })).toBe('open');
  });

  it('is nearly_full at or above 85% occupancy', () => {
    expect(deriveCampStatus({ beneficiaries_accepted: 85, beneficiary_capacity: 100 })).toBe('nearly_full');
    expect(deriveCampStatus({ beneficiaries_accepted: 84, beneficiary_capacity: 100 })).toBe('open');
  });

  it('is full at or above capacity', () => {
    expect(deriveCampStatus({ beneficiaries_accepted: 100, beneficiary_capacity: 100 })).toBe('full');
    expect(deriveCampStatus({ beneficiaries_accepted: 105, beneficiary_capacity: 100 })).toBe('full');
  });

  it('treats zero capacity as full rather than dividing by zero', () => {
    expect(deriveCampStatus({ beneficiaries_accepted: 0, beneficiary_capacity: 0 })).toBe('full');
  });

  it('an admin override always wins over the computed value', () => {
    expect(deriveCampStatus({ beneficiaries_accepted: 0, beneficiary_capacity: 100, admin_override: 'temporarily_closed' })).toBe('temporarily_closed');
    expect(deriveCampStatus({ beneficiaries_accepted: 100, beneficiary_capacity: 100, admin_override: 'closed' })).toBe('closed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — cannot resolve `./camp.status.js`.

- [ ] **Step 3: Implement it**

Create `server/src/modules/camps/camp.status.js`:

```js
// Occupancy percentage at which a camp is shown as nearing capacity, ahead
// of the point it can no longer accept anyone. A judgment call, not a spec
// requirement — change this constant if the real deployment needs another
// threshold.
const NEARLY_FULL_THRESHOLD = 0.85;

/**
 * Status is computed from occupancy, per requirements §18 ("every dashboard
 * figure computed, not manually entered") — except the two lifecycle states
 * only Admin can set. An override, once in force, always wins: a camp an
 * admin has temporarily closed does not reopen itself just because a bed
 * frees up.
 */
export function deriveCampStatus({ beneficiaries_accepted, beneficiary_capacity, admin_override = null }) {
  if (admin_override === 'temporarily_closed' || admin_override === 'closed') return admin_override;

  if (beneficiary_capacity <= 0) return 'full';
  const occupancy = beneficiaries_accepted / beneficiary_capacity;
  if (occupancy >= 1) return 'full';
  if (occupancy >= NEARLY_FULL_THRESHOLD) return 'nearly_full';
  return 'open';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace server`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/camps/camp.status.js server/src/modules/camps/camp.status.test.js
git commit -m "$(cat <<'EOF'
feat: add pure camp-status derivation function

Open/Nearly Full/Full track occupancy, which requirements section 18
requires to be computed rather than manually entered. Temporarily Closed
and Closed are the two lifecycle actions only Admin can take (section
6.3), and an override, once set, always wins over the computed value — a
camp an admin closed does not reopen itself just because a bed frees up.

85% is a judgment call for the nearly-full threshold, isolated to one
constant so it is easy to change without touching call sites.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Affected areas and flood alerts module

**Files:**
- Create: `shared/src/schemas/area.schema.js`
- Create: `server/src/modules/areas/{affectedArea.model.js,floodAlert.model.js,areas.service.js,areas.controller.js,areas.routes.js}`
- Modify: `shared/src/index.js`, `server/src/app.js`
- Test: `server/src/modules/areas/areas.test.js`

**Interfaces:**
- Consumes: `authenticate`, `authorize`, `validate`, `recordAudit`, `AppError` (Plan 1)
- Produces:
  - `AffectedArea` model, `FloodAlert` model
  - `createArea(input, {actorId, actorRole, ip}): Promise<AffectedArea>`, `listAreas(): Promise<AffectedArea[]>`
  - `createAlert(input, {actorId, actorRole, ip}): Promise<FloodAlert>`, `listActiveAlerts(): Promise<FloodAlert[]>`
  - `POST /api/areas`, `GET /api/areas`, `POST /api/areas/:areaId/alerts`, `GET /api/alerts/active`

**Why alerts live with areas, not their own top-level module:** every flood alert names the area it concerns (spec §6.1's "Show nearby active camps for the area" and the landing page's alert banner both key off area, not the other way round) — splitting them would mean two modules constantly reaching across each other's boundary for the one thing they always need together.

- [ ] **Step 1: Write the failing schema test**

Create `shared/src/schemas/area.schema.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createAreaSchema, createAlertSchema } from './area.schema.js';

const validArea = {
  name: 'Ward 12',
  district: 'North District',
  state: 'Assam',
  address: 'Near river embankment, Ward 12',
  latitude: 26.2,
  longitude: 91.7,
  severity: 'high',
};

describe('createAreaSchema', () => {
  it('accepts a complete area', () => {
    expect(createAreaSchema.safeParse(validArea).success).toBe(true);
  });

  it('accepts only the four defined severities', () => {
    for (const severity of ['low', 'medium', 'high', 'critical']) {
      expect(createAreaSchema.safeParse({ ...validArea, severity }).success).toBe(true);
    }
    expect(createAreaSchema.safeParse({ ...validArea, severity: 'extreme' }).success).toBe(false);
  });

  it('requires a name, district and coordinates', () => {
    expect(createAreaSchema.safeParse({ ...validArea, name: '' }).success).toBe(false);
    expect(createAreaSchema.safeParse({ ...validArea, latitude: undefined }).success).toBe(false);
  });

  it('rejects a latitude or longitude outside valid range', () => {
    expect(createAreaSchema.safeParse({ ...validArea, latitude: 200 }).success).toBe(false);
    expect(createAreaSchema.safeParse({ ...validArea, longitude: -200 }).success).toBe(false);
  });

  it('accepts optional estimated population and families', () => {
    const parsed = createAreaSchema.parse({ ...validArea, estimated_population: 1200, estimated_families: 260 });
    expect(parsed.estimated_population).toBe(1200);
  });
});

describe('createAlertSchema', () => {
  it('accepts a message and severity tied to an area', () => {
    const result = createAlertSchema.safeParse({ message: 'Water level rising fast.', severity: 'critical' });
    expect(result.success).toBe(true);
  });

  it('requires a non-empty message', () => {
    expect(createAlertSchema.safeParse({ message: '', severity: 'high' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace shared`
Expected: FAIL — cannot resolve `./area.schema.js`.

- [ ] **Step 3: Implement the schemas**

Create `shared/src/schemas/area.schema.js`:

```js
import { z } from 'zod';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

export const createAreaSchema = z.object({
  name: z.string().trim().min(2, 'Area name is required.').max(160),
  district: z.string().trim().min(1, 'District is required.'),
  state: z.string().trim().min(1, 'State is required.'),
  address: z.string().trim().min(1, 'Address or location description is required.'),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  severity: z.enum(SEVERITIES, { message: 'Select a valid severity.' }),
  estimated_population: z.coerce.number().int().nonnegative().optional(),
  estimated_families: z.coerce.number().int().nonnegative().optional(),
  source: z.string().trim().max(200).optional(),
});

export const createAlertSchema = z.object({
  message: z.string().trim().min(1, 'Alert message is required.').max(500),
  severity: z.enum(SEVERITIES, { message: 'Select a valid severity.' }),
});
```

Modify `shared/src/index.js` — add:

```js
export * from './schemas/area.schema.js';
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace shared`
Expected: PASS — 7 new tests.

- [ ] **Step 5: Write the failing server test**

Create `server/src/modules/areas/areas.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { AffectedArea } from './affectedArea.model.js';
import { FloodAlert } from './floodAlert.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role) {
  return User.create({
    name: 'Test', mobile: String(9100000000 + Math.floor(Math.random() * 899999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active',
  });
}
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

const areaBody = {
  name: 'Ward 12', district: 'North District', state: 'Assam',
  address: 'Near river embankment', latitude: 26.2, longitude: 91.7, severity: 'high',
};

describe('POST /api/areas', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin record an affected area', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).post('/api/areas').set(bearer(admin)).send(areaBody);
    expect(res.status).toBe(201);
    expect(res.body.area).toMatchObject({ name: 'Ward 12', severity: 'high' });
  });

  it('refuses a non-admin', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).post('/api/areas').set(bearer(donor)).send(areaBody);
    expect(res.status).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/areas').send(areaBody);
    expect(res.status).toBe(401);
  });

  it('validates the payload', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).post('/api/areas').set(bearer(admin)).send({ ...areaBody, severity: 'extreme' });
    expect(res.status).toBe(400);
  });

  it('writes an audit record', async () => {
    const admin = await makeUser('admin');
    await request(app).post('/api/areas').set(bearer(admin)).send(areaBody);
    const area = await AffectedArea.findOne({ name: 'Ward 12' });
    expect(area).toBeTruthy();
  });
});

describe('GET /api/areas', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lists areas for any authenticated user', async () => {
    const admin = await makeUser('admin');
    await request(app).post('/api/areas').set(bearer(admin)).send(areaBody);
    const donor = await makeUser('donor');
    const res = await request(app).get('/api/areas').set(bearer(donor));
    expect(res.status).toBe(200);
    expect(res.body.areas).toHaveLength(1);
  });
});

describe('flood alerts', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin raise an alert tied to an area', async () => {
    const admin = await makeUser('admin');
    const areaRes = await request(app).post('/api/areas').set(bearer(admin)).send(areaBody);
    const areaId = areaRes.body.area.id;

    const res = await request(app)
      .post(`/api/areas/${areaId}/alerts`)
      .set(bearer(admin))
      .send({ message: 'Water level rising fast.', severity: 'critical' });

    expect(res.status).toBe(201);
    expect(res.body.alert).toMatchObject({ message: 'Water level rising fast.', severity: 'critical', status: 'active' });
  });

  it('404s when the area does not exist', async () => {
    const admin = await makeUser('admin');
    const res = await request(app)
      .post('/api/areas/000000000000000000000000/alerts')
      .set(bearer(admin))
      .send({ message: 'x', severity: 'high' });
    expect(res.status).toBe(404);
  });

  it('lists only active alerts for any authenticated user', async () => {
    const admin = await makeUser('admin');
    const areaRes = await request(app).post('/api/areas').set(bearer(admin)).send(areaBody);
    const areaId = areaRes.body.area.id;
    await request(app).post(`/api/areas/${areaId}/alerts`).set(bearer(admin)).send({ message: 'Active one', severity: 'high' });
    await FloodAlert.updateMany({}, {}); // no-op, keeps intent explicit that only one alert exists

    const donor = await makeUser('donor');
    const res = await request(app).get('/api/alerts/active').set(bearer(donor));
    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0].area_name).toBe('Ward 12');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — cannot resolve `./affectedArea.model.js`.

- [ ] **Step 7: Implement the models**

Create `server/src/modules/areas/affectedArea.model.js`:

```js
import mongoose from 'mongoose';
import { SEVERITIES } from '@frp/shared';

const affectedAreaSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    district: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [longitude, latitude]
    },
    severity: { type: String, required: true, enum: SEVERITIES, index: true },
    estimated_population: { type: Number, default: null },
    estimated_families: { type: Number, default: null },
    source: { type: String, default: 'manual Admin entry' },
    identified_at: { type: Date, default: Date.now },
    recorded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'affected_areas' }
);

affectedAreaSchema.index({ location: '2dsphere' });

affectedAreaSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    district: this.district,
    state: this.state,
    address: this.address,
    latitude: this.location.coordinates[1],
    longitude: this.location.coordinates[0],
    severity: this.severity,
    estimated_population: this.estimated_population,
    estimated_families: this.estimated_families,
    identified_at: this.identified_at,
  };
};

export const AffectedArea = mongoose.model('AffectedArea', affectedAreaSchema);
```

Create `server/src/modules/areas/floodAlert.model.js`:

```js
import mongoose from 'mongoose';
import { SEVERITIES } from '@frp/shared';

const floodAlertSchema = new mongoose.Schema(
  {
    area_id: { type: mongoose.Schema.Types.ObjectId, ref: 'AffectedArea', required: true, index: true },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    severity: { type: String, required: true, enum: SEVERITIES },
    status: { type: String, required: true, enum: ['active', 'resolved'], default: 'active', index: true },
    raised_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    resolved_at: { type: Date, default: null },
  },
  { timestamps: true, collection: 'flood_alerts' }
);

export const FloodAlert = mongoose.model('FloodAlert', floodAlertSchema);
```

- [ ] **Step 8: Implement the service**

Create `server/src/modules/areas/areas.service.js`:

```js
import { AffectedArea } from './affectedArea.model.js';
import { FloodAlert } from './floodAlert.model.js';
import { AppError } from '../../core/errors.js';
import { recordAudit } from '../audit/audit.service.js';

export async function createArea(input, { actorId, actorRole, ip }) {
  const { latitude, longitude, ...rest } = input;
  const area = await AffectedArea.create({
    ...rest,
    location: { type: 'Point', coordinates: [longitude, latitude] },
    recorded_by: actorId,
  });

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'area.create',
    module: 'areas', record_id: area._id, after: area.toSafeJSON(), ip,
  });

  return area;
}

export async function listAreas() {
  return AffectedArea.find().sort({ createdAt: -1 });
}

export async function createAlert(areaId, input, { actorId, actorRole, ip }) {
  const area = await AffectedArea.findById(areaId);
  if (!area) throw AppError.notFound('No affected area with that id.');

  const alert = await FloodAlert.create({ ...input, area_id: area._id, raised_by: actorId });

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'alert.create',
    module: 'areas', record_id: alert._id,
    after: { area_id: area._id.toString(), message: alert.message, severity: alert.severity }, ip,
  });

  return { alert, area };
}

export async function listActiveAlerts() {
  const alerts = await FloodAlert.find({ status: 'active' }).sort({ createdAt: -1 }).populate('area_id', 'name district');
  return alerts.map((a) => ({
    id: a._id.toString(),
    message: a.message,
    severity: a.severity,
    area_id: a.area_id._id.toString(),
    area_name: a.area_id.name,
    area_district: a.area_id.district,
    createdAt: a.createdAt,
  }));
}
```

- [ ] **Step 9: Implement the controller and routes**

Create `server/src/modules/areas/areas.controller.js`:

```js
import * as areasService from './areas.service.js';

export async function createAreaHandler(req, res) {
  const area = await areasService.createArea(req.body, { actorId: req.user.id, actorRole: req.user.role, ip: req.ip });
  res.status(201).json({ area: area.toSafeJSON() });
}

export async function listAreasHandler(req, res) {
  const areas = await areasService.listAreas();
  res.json({ areas: areas.map((a) => a.toSafeJSON()) });
}

export async function createAlertHandler(req, res) {
  const { alert } = await areasService.createAlert(req.params.areaId, req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.status(201).json({
    alert: { id: alert._id.toString(), message: alert.message, severity: alert.severity, status: alert.status, area_id: alert.area_id.toString() },
  });
}

export async function listActiveAlertsHandler(req, res) {
  const alerts = await areasService.listActiveAlerts();
  res.json({ alerts });
}
```

Create `server/src/modules/areas/areas.routes.js`:

```js
import { Router } from 'express';
import { createAreaSchema, createAlertSchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  createAreaHandler, listAreasHandler, createAlertHandler, listActiveAlertsHandler,
} from './areas.controller.js';

export const areasRouter = Router();
areasRouter.post('/areas', authenticate, authorize('admin'), validate(createAreaSchema), createAreaHandler);
areasRouter.get('/areas', authenticate, listAreasHandler);
areasRouter.post('/areas/:areaId/alerts', authenticate, authorize('admin'), validate(createAlertSchema), createAlertHandler);
areasRouter.get('/alerts/active', authenticate, listActiveAlertsHandler);
```

Modify `server/src/app.js` — add the import and mount above `notFoundHandler`:

```js
import { areasRouter } from './modules/areas/areas.routes.js';
// ...
app.use('/api', areasRouter);
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npm test --workspace server`
Expected: PASS — 8 new tests.

- [ ] **Step 11: Commit**

```bash
git add shared/ server/
git commit -m "$(cat <<'EOF'
feat: add affected areas and flood alerts module

Admin records an affected area (requirements section 6.1: name, district,
coordinates, severity, estimated population) and can raise flood alerts
against it. Alerts live in the areas module rather than their own, because
every alert names the area it concerns and the landing page's alert banner
reads them together.

toSafeJSON() flattens the GeoJSON location back to latitude/longitude for
the API surface, so nothing outside this module needs to know Mongo stores
points as [longitude, latitude].

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Camp model — full §6.3 field set

**Files:**
- Create: `shared/src/schemas/camp.schema.js`
- Create: `server/src/modules/camps/camp.model.js`
- Modify: `shared/src/index.js`
- Test: `server/src/modules/camps/camp.model.test.js`

**Interfaces:**
- Consumes: `deriveCampStatus` (Task 1)
- Produces: `Camp` model with `toSafeJSON()`; `createCampSchema` (zod)

Every field group from §6.3's table, verbatim: Identity, Location (with a
`2dsphere` index for nearest-camp), Flood Context (linking an affected
area), Capacity & Duration, Facilities, Management, Emergency contacts.
`beneficiaries_accepted` and `volunteers_accepted` default to `0` and are
never part of the create/update schema — Task 4's service is the only
writer, guarded by the atomic compare-and-swap pattern spec §5.3 requires.

- [ ] **Step 1: Write the failing schema test**

Create `shared/src/schemas/camp.schema.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createCampSchema } from './camp.schema.js';

const valid = {
  name: 'Riverside Community Hall',
  camp_type: 'community_hall',
  description: 'Ground-floor hall, wheelchair accessible.',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam',
  pincode: '781001', latitude: 26.2, longitude: 91.7,
  flood_severity: 'high',
  beneficiary_capacity: 400, volunteer_capacity: 30, duration_days: 14,
  facilities: { food: true, drinking_water: true, medical_support: true, toilets_count: 12 },
  assigned_official_id: '507f1f77bcf86cd799439011',
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
};

describe('createCampSchema', () => {
  it('accepts a complete camp', () => {
    const result = createCampSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('requires beneficiary capacity, volunteer capacity and duration (section 6.3 mandatory fields)', () => {
    expect(createCampSchema.safeParse({ ...valid, beneficiary_capacity: undefined }).success).toBe(false);
    expect(createCampSchema.safeParse({ ...valid, volunteer_capacity: undefined }).success).toBe(false);
    expect(createCampSchema.safeParse({ ...valid, duration_days: undefined }).success).toBe(false);
  });

  it('requires both emergency contacts', () => {
    expect(createCampSchema.safeParse({ ...valid, nearest_hospital_contact: undefined }).success).toBe(false);
    expect(createCampSchema.safeParse({ ...valid, nearest_police_contact: undefined }).success).toBe(false);
  });

  it('rejects a negative or zero capacity', () => {
    expect(createCampSchema.safeParse({ ...valid, beneficiary_capacity: 0 }).success).toBe(false);
    expect(createCampSchema.safeParse({ ...valid, volunteer_capacity: -5 }).success).toBe(false);
  });

  it('accepts only the four defined camp types', () => {
    for (const t of ['school', 'auditorium', 'community_hall', 'other']) {
      expect(createCampSchema.safeParse({ ...valid, camp_type: t }).success).toBe(true);
    }
    expect(createCampSchema.safeParse({ ...valid, camp_type: 'stadium' }).success).toBe(false);
  });

  it('defaults every facility flag to false and toilets_count to 0 when omitted', () => {
    const { facilities, ...rest } = valid;
    const parsed = createCampSchema.parse(rest);
    expect(parsed.facilities).toEqual({
      food: false, drinking_water: false, medical_support: false, toilets_count: 0,
      electricity: false, accommodation: false, charging_points: false, internet: false,
      child_care: false, womens_facilities: false, disability_friendly: false,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace shared`
Expected: FAIL — cannot resolve `./camp.schema.js`.

- [ ] **Step 3: Implement the schema**

Create `shared/src/schemas/camp.schema.js`:

```js
import { z } from 'zod';
import { SEVERITIES } from './area.schema.js';

export const CAMP_TYPES = ['school', 'auditorium', 'community_hall', 'other'];
export const CAMP_STATUSES = ['open', 'nearly_full', 'full', 'temporarily_closed', 'closed'];

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id.');

const facilitiesSchema = z
  .object({
    food: z.boolean().default(false),
    drinking_water: z.boolean().default(false),
    medical_support: z.boolean().default(false),
    toilets_count: z.coerce.number().int().nonnegative().default(0),
    electricity: z.boolean().default(false),
    accommodation: z.boolean().default(false),
    charging_points: z.boolean().default(false),
    internet: z.boolean().default(false),
    child_care: z.boolean().default(false),
    womens_facilities: z.boolean().default(false),
    disability_friendly: z.boolean().default(false),
  })
  .default({});

export const createCampSchema = z.object({
  // Identity
  name: z.string().trim().min(2, 'Camp name is required.').max(160),
  camp_type: z.enum(CAMP_TYPES, { message: 'Select a valid camp type.' }),
  description: z.string().trim().max(1000).optional(),

  // Location
  address: z.string().trim().min(1, 'Address is required.'),
  area: z.string().trim().min(1, 'Area is required.'),
  district: z.string().trim().min(1, 'District is required.'),
  state: z.string().trim().min(1, 'State is required.'),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6-digit pincode.'),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),

  // Flood context
  linked_area_id: objectId.optional(),
  flood_severity: z.enum(SEVERITIES, { message: 'Select a valid severity.' }),
  date_affected: z.coerce.date().optional(),
  estimated_affected_population: z.coerce.number().int().nonnegative().optional(),
  reason_for_camp: z.string().trim().max(500).optional(),

  // Capacity & duration — mandatory per requirements section 6.3's own intro sentence
  beneficiary_capacity: z.coerce.number().int().positive('Beneficiary capacity must be at least 1.'),
  volunteer_capacity: z.coerce.number().int().positive('Volunteer capacity must be at least 1.'),
  duration_days: z.coerce.number().int().positive('Duration must be at least 1 day.'),
  opening_date: z.coerce.date().optional(),
  expected_closing_date: z.coerce.date().optional(),

  // Facilities
  facilities: facilitiesSchema,

  // Management
  assigned_official_id: objectId.optional(),
  official_contact_number: z.string().trim().optional(),

  // Emergency — both mandatory: requirements section 6.3 ties medical/security SOS
  // routing directly to these two contacts, so a camp without them cannot safely open.
  nearest_hospital_name: z.string().trim().min(1, 'Nearest hospital name is required.'),
  nearest_hospital_contact: z.string().trim().min(1, 'Nearest hospital contact is required.'),
  nearest_police_name: z.string().trim().min(1, 'Nearest police station name is required.'),
  nearest_police_contact: z.string().trim().min(1, 'Nearest police contact is required.'),
});

export const updateCampSchema = createCampSchema.partial().extend({
  admin_override: z.enum(['temporarily_closed', 'closed']).nullable().optional(),
});
```

Modify `shared/src/index.js` — add:

```js
export * from './schemas/camp.schema.js';
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace shared`
Expected: PASS — 6 new tests.

- [ ] **Step 5: Write the failing model test**

Create `server/src/modules/camps/camp.model.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Camp } from './camp.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const validAttrs = () => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  location: { type: 'Point', coordinates: [91.7, 26.2] },
  flood_severity: 'high',
  beneficiary_capacity: 400, volunteer_capacity: 30, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  created_by: new mongoose.Types.ObjectId(),
});

describe('Camp model', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates a camp with occupancy counters defaulted to zero', async () => {
    const camp = await Camp.create(validAttrs());
    expect(camp.beneficiaries_accepted).toBe(0);
    expect(camp.volunteers_accepted).toBe(0);
  });

  it('defaults status to open', async () => {
    const camp = await Camp.create(validAttrs());
    expect(camp.status).toBe('open');
  });

  it('rejects a camp missing an emergency contact', async () => {
    const attrs = validAttrs();
    delete attrs.nearest_police_contact;
    await expect(Camp.create(attrs)).rejects.toThrow();
  });

  it('serializes latitude/longitude back out of the GeoJSON point', async () => {
    const camp = await Camp.create(validAttrs());
    const json = camp.toSafeJSON();
    expect(json.latitude).toBe(26.2);
    expect(json.longitude).toBe(91.7);
  });

  it('exposes the full facilities object with defaults', async () => {
    const camp = await Camp.create(validAttrs());
    expect(camp.toSafeJSON().facilities).toMatchObject({ food: false, toilets_count: 0 });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — cannot resolve `./camp.model.js`.

- [ ] **Step 7: Implement the model**

Create `server/src/modules/camps/camp.model.js`:

```js
import mongoose from 'mongoose';
import { SEVERITIES } from '@frp/shared';
import { CAMP_TYPES, CAMP_STATUSES } from '@frp/shared';

const facilitiesSchema = new mongoose.Schema(
  {
    food: { type: Boolean, default: false },
    drinking_water: { type: Boolean, default: false },
    medical_support: { type: Boolean, default: false },
    toilets_count: { type: Number, default: 0 },
    electricity: { type: Boolean, default: false },
    accommodation: { type: Boolean, default: false },
    charging_points: { type: Boolean, default: false },
    internet: { type: Boolean, default: false },
    child_care: { type: Boolean, default: false },
    womens_facilities: { type: Boolean, default: false },
    disability_friendly: { type: Boolean, default: false },
  },
  { _id: false }
);

const campSchema = new mongoose.Schema(
  {
    // Identity
    name: { type: String, required: true, trim: true, maxlength: 160 },
    camp_type: { type: String, required: true, enum: CAMP_TYPES },
    description: { type: String, default: '' },
    status: { type: String, required: true, enum: CAMP_STATUSES, default: 'open', index: true },
    admin_override: { type: String, enum: ['temporarily_closed', 'closed', null], default: null },

    // Location
    address: { type: String, required: true, trim: true },
    area: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true, index: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [longitude, latitude]
    },

    // Flood context
    linked_area_id: { type: mongoose.Schema.Types.ObjectId, ref: 'AffectedArea', default: null },
    flood_severity: { type: String, required: true, enum: SEVERITIES },
    date_affected: { type: Date, default: null },
    estimated_affected_population: { type: Number, default: null },
    reason_for_camp: { type: String, default: '' },

    // Capacity & duration
    beneficiary_capacity: { type: Number, required: true, min: 1 },
    volunteer_capacity: { type: Number, required: true, min: 1 },
    duration_days: { type: Number, required: true, min: 1 },
    opening_date: { type: Date, default: null },
    expected_closing_date: { type: Date, default: null },
    actual_closing_date: { type: Date, default: null },

    // Live counters — written ONLY by camps.service.js's guarded atomic update.
    beneficiaries_accepted: { type: Number, default: 0, min: 0 },
    volunteers_accepted: { type: Number, default: 0, min: 0 },

    // Facilities
    facilities: { type: facilitiesSchema, default: () => ({}) },

    // Management
    assigned_official_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    official_contact_number: { type: String, default: '' },
    assignment_date: { type: Date, default: null },

    // Emergency
    nearest_hospital_name: { type: String, required: true, trim: true },
    nearest_hospital_contact: { type: String, required: true, trim: true },
    nearest_police_name: { type: String, required: true, trim: true },
    nearest_police_contact: { type: String, required: true, trim: true },

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'camps' }
);

campSchema.index({ location: '2dsphere' });

campSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    camp_type: this.camp_type,
    description: this.description,
    status: this.status,
    address: this.address, area: this.area, district: this.district, state: this.state, pincode: this.pincode,
    latitude: this.location.coordinates[1], longitude: this.location.coordinates[0],
    linked_area_id: this.linked_area_id ? this.linked_area_id.toString() : null,
    flood_severity: this.flood_severity,
    beneficiary_capacity: this.beneficiary_capacity,
    volunteer_capacity: this.volunteer_capacity,
    duration_days: this.duration_days,
    opening_date: this.opening_date,
    expected_closing_date: this.expected_closing_date,
    beneficiaries_accepted: this.beneficiaries_accepted,
    volunteers_accepted: this.volunteers_accepted,
    facilities: this.facilities.toObject ? this.facilities.toObject() : this.facilities,
    assigned_official_id: this.assigned_official_id ? this.assigned_official_id.toString() : null,
    nearest_hospital_name: this.nearest_hospital_name,
    nearest_hospital_contact: this.nearest_hospital_contact,
    nearest_police_name: this.nearest_police_name,
    nearest_police_contact: this.nearest_police_contact,
  };
};

export const Camp = mongoose.model('Camp', campSchema);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test --workspace server`
Expected: PASS — 5 new tests.

- [ ] **Step 9: Commit**

```bash
git add shared/ server/src/modules/camps/camp.model.js server/src/modules/camps/camp.model.test.js
git commit -m "$(cat <<'EOF'
feat: add Camp model with the full requirements section 6.3 field set

Every field group from section 6.3's table: identity, location (with a
2dsphere index for the nearest-camp query Task 5 adds), flood context,
capacity and duration, facilities, management, and both emergency
contacts — hospital and police are both mandatory, since section 6.3 ties
medical and security SOS routing directly to them.

beneficiaries_accepted and volunteers_accepted default to zero and are
absent from the create/update schema entirely: Task 4's service is the
only writer, through the guarded atomic update spec section 5.3 requires,
so occupancy can never be set directly from a request body.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Socket.IO server core

**Files:**
- Create: `server/src/core/socket.js`
- Test: `server/src/core/socket.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `initSocket(httpServer): Server`, `emitCampOccupancy(campId, payload): void`, `getIO(): Server|null`

**Why this is its own task, before the camps service that will call it:**
spec §7.3 says Socket.IO events invalidate query keys — the camps service
(Task 5) needs something to call the moment it's written, and that
something has to exist and be tested first. `emitCampOccupancy` is a
no-op, not a throw, when no server is attached, because an occupancy
change must never fail (or block) just because nothing happens to be
listening — the seed script and one-off scripts create camps too.

- [ ] **Step 1: Install Socket.IO**

```bash
npm install socket.io --workspace server
npm install -D socket.io-client --workspace server
```

- [ ] **Step 2: Write the failing test**

Create `server/src/core/socket.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { io as ioClient } from 'socket.io-client';
import { createApp } from '../app.js';
import { initSocket, emitCampOccupancy } from './socket.js';

let httpServer, port, client;

beforeAll(async () => {
  const app = createApp();
  httpServer = http.createServer(app);
  initSocket(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

afterAll(async () => {
  client?.close();
  await new Promise((resolve) => httpServer.close(resolve));
});

describe('emitCampOccupancy', () => {
  it('broadcasts a camp:occupancy event to connected clients', async () => {
    client = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
    await new Promise((resolve) => client.on('connect', resolve));

    const received = new Promise((resolve) => client.once('camp:occupancy', resolve));
    emitCampOccupancy('camp123', { beneficiaries_accepted: 5, status: 'open' });

    const event = await received;
    expect(event).toEqual({ campId: 'camp123', beneficiaries_accepted: 5, status: 'open' });
  });

  it('is safe to call with no connected clients', () => {
    expect(() => emitCampOccupancy('nobody-listening', { status: 'open' })).not.toThrow();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — cannot resolve `./socket.js`.

- [ ] **Step 4: Implement it**

Create `server/src/core/socket.js`:

```js
import { Server } from 'socket.io';
import { env } from '../config/env.js';

let io = null;

/** Attach Socket.IO to the given http.Server. Call once, from server.js. */
export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
  });
  return io;
}

/**
 * Emit a camp occupancy change to every connected client. A no-op, not a
 * throw, when no server has been attached — the seed script and one-off
 * scripts create camps too, and an occupancy change must never fail just
 * because nothing happens to be listening.
 */
export function emitCampOccupancy(campId, payload) {
  if (!io) return;
  io.emit('camp:occupancy', { campId: String(campId), ...payload });
}

export function getIO() {
  return io;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace server`
Expected: PASS — 2 tests.

- [ ] **Step 6: Wire it into the real server entrypoint**

The test attaches Socket.IO to its own throwaway `http.Server` — the
actual running app never does, so without this step `emitCampOccupancy`
would be a permanent no-op outside tests. Replace
`server/src/server.js` (from Plan 1's Task 8) entirely:

```js
import http from 'node:http';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { initSocket } from './core/socket.js';

async function start() {
  await connectDb();
  const app = createApp();
  const httpServer = http.createServer(app);
  initSocket(httpServer);
  httpServer.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
}

start().catch((err) => {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
});
```

The only change from Plan 1's version is `app.listen()` becoming
`http.createServer(app)` + `initSocket()` + `httpServer.listen()` —
`createApp()` itself is untouched, so every existing server test still
mounts the plain Express app exactly as before.

- [ ] **Step 7: Commit**

```bash
git add server/
git commit -m "$(cat <<'EOF'
feat: add Socket.IO server core, wired into the real entrypoint

emitCampOccupancy() is what Task 5's camps service calls the moment
occupancy changes, per spec section 7.3 — clients invalidate their
`camps` query key on receipt rather than being pushed state directly, so
a live update travels the same code path as an ordinary fetch.

It's a no-op rather than a throw when no server is attached: the seed
script and one-off scripts create camps too, and an occupancy change must
never fail just because nothing happens to be listening.

server.js now creates its own http.Server and calls initSocket() on it
rather than app.listen() directly — without this the socket core would
work in tests (which build their own throwaway http.Server) and nowhere
else. createApp() itself is unchanged, so every existing test still mounts
the plain Express app.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Camps service — create/list/update, the capacity guard, nearest-camp

**Files:**
- Create: `server/src/modules/camps/camps.service.js`
- Test: `server/src/modules/camps/camps.service.test.js`

**Interfaces:**
- Consumes: `Camp` (Task 3), `deriveCampStatus` (Task 1), `emitCampOccupancy` (Task 4), `AppError`, `recordAudit`, `withTransaction`
- Produces:
  - `createCamp(input, {actorId,actorRole,ip}): Promise<Camp>`
  - `listCamps({status?, district?}): Promise<Camp[]>`, `getCampById(id): Promise<Camp>`
  - `updateCamp(id, input, {actorId,actorRole,ip}): Promise<Camp>`
  - `reserveBeneficiarySlots(campId, n, session?): Promise<Camp|null>` — `null` means "would overshoot"
  - `findNearestOpenCamps({latitude, longitude, excludeCampId?, limit?}): Promise<Array>`

**This is the task with the invariant that matters.** `reserveBeneficiarySlots`
is spec §5.3's compare-and-swap, verbatim: the `$expr` in the filter and the
`$inc` in the update happen as one atomic MongoDB operation, so two
concurrent calls for the last bed cannot both succeed. The test proves it
by actually racing two calls with `Promise.all`, not by reasoning about the
code — a race test that never contends proves nothing.

- [ ] **Step 1: Write the failing test**

Create `server/src/modules/camps/camps.service.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import * as campsService from './camps.service.js';
import { Camp } from './camp.model.js';
import { withTransaction } from '../../core/transaction.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const baseCampInput = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7,
  flood_severity: 'high',
  beneficiary_capacity: 10, volunteer_capacity: 5, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

const actor = () => ({ actorId: new mongoose.Types.ObjectId(), actorRole: 'admin', ip: '127.0.0.1' });

describe('createCamp', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates a camp with computed status open', async () => {
    const camp = await campsService.createCamp(baseCampInput(), actor());
    expect(camp.status).toBe('open');
  });
});

describe('updateCamp', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('recomputes status after an admin_override change', async () => {
    const camp = await campsService.createCamp(baseCampInput(), actor());
    const updated = await campsService.updateCamp(camp._id, { admin_override: 'temporarily_closed' }, actor());
    expect(updated.status).toBe('temporarily_closed');
  });

  it('records before/after in the audit trail', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 10 }), actor());
    await campsService.updateCamp(camp._id, { beneficiary_capacity: 20 }, actor());
    const saved = await Camp.findById(camp._id);
    expect(saved.beneficiary_capacity).toBe(20);
  });
});

describe('reserveBeneficiarySlots', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('reserves slots and updates the counter', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 10 }), actor());
    const updated = await campsService.reserveBeneficiarySlots(camp._id, 4);
    expect(updated.beneficiaries_accepted).toBe(4);
  });

  it('refuses to overshoot capacity, returning null and changing nothing', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 5 }), actor());
    await campsService.reserveBeneficiarySlots(camp._id, 4);
    const overshoot = await campsService.reserveBeneficiarySlots(camp._id, 2);
    expect(overshoot).toBeNull();
    const saved = await Camp.findById(camp._id);
    expect(saved.beneficiaries_accepted).toBe(4);
  });

  it('never overshoots under concurrent reservations for the last bed', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 5 }), actor());
    await campsService.reserveBeneficiarySlots(camp._id, 4); // 1 bed left

    const [a, b] = await Promise.all([
      campsService.reserveBeneficiarySlots(camp._id, 1),
      campsService.reserveBeneficiarySlots(camp._id, 1),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one of the two wins

    const saved = await Camp.findById(camp._id);
    expect(saved.beneficiaries_accepted).toBe(5);
  });

  it('promotes status to full when capacity is reached', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 5 }), actor());
    const updated = await campsService.reserveBeneficiarySlots(camp._id, 5);
    expect(updated.status).toBe('full');
  });

  it('rolls back the reservation if the enclosing transaction aborts', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 5 }), actor());
    await expect(
      withTransaction(async (session) => {
        await campsService.reserveBeneficiarySlots(camp._id, 3, session);
        throw new Error('caller failed');
      })
    ).rejects.toThrow('caller failed');

    const saved = await Camp.findById(camp._id);
    expect(saved.beneficiaries_accepted).toBe(0);
  });
});

describe('findNearestOpenCamps', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('returns camps with remaining capacity, closest first, excluding a full one', async () => {
    await campsService.createCamp(
      baseCampInput({ name: 'Near Camp', latitude: 26.20, longitude: 91.70, beneficiary_capacity: 10 }), actor()
    );
    await campsService.createCamp(
      baseCampInput({ name: 'Far Camp', latitude: 27.50, longitude: 93.00, beneficiary_capacity: 10 }), actor()
    );
    const full = await campsService.createCamp(
      baseCampInput({ name: 'Full Camp', latitude: 26.21, longitude: 91.71, beneficiary_capacity: 2 }), actor()
    );
    await campsService.reserveBeneficiarySlots(full._id, 2);

    const results = await campsService.findNearestOpenCamps({ latitude: 26.20, longitude: 91.70 });
    const names = results.map((r) => r.name);
    expect(names).not.toContain('Full Camp');
    expect(names[0]).toBe('Near Camp');
    expect(names.indexOf('Near Camp')).toBeLessThan(names.indexOf('Far Camp'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — cannot resolve `./camps.service.js`.

- [ ] **Step 3: Implement it**

Create `server/src/modules/camps/camps.service.js`:

```js
import mongoose from 'mongoose';
import { Camp } from './camp.model.js';
import { deriveCampStatus } from './camp.status.js';
import { AppError } from '../../core/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { emitCampOccupancy } from '../../core/socket.js';

function recomputeStatus(camp) {
  camp.status = deriveCampStatus({
    beneficiaries_accepted: camp.beneficiaries_accepted,
    beneficiary_capacity: camp.beneficiary_capacity,
    admin_override: camp.admin_override,
  });
}

function broadcastOccupancy(camp) {
  emitCampOccupancy(camp._id, {
    beneficiaries_accepted: camp.beneficiaries_accepted,
    beneficiary_capacity: camp.beneficiary_capacity,
    volunteers_accepted: camp.volunteers_accepted,
    volunteer_capacity: camp.volunteer_capacity,
    status: camp.status,
  });
}

export async function createCamp(input, { actorId, actorRole, ip }) {
  const { latitude, longitude, ...rest } = input;
  const camp = new Camp({
    ...rest,
    location: { type: 'Point', coordinates: [longitude, latitude] },
    created_by: actorId,
  });
  recomputeStatus(camp);
  await camp.save();

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'camp.create',
    module: 'camps', record_id: camp._id, after: camp.toSafeJSON(), ip,
  });

  broadcastOccupancy(camp);
  return camp;
}

export async function listCamps({ status, district } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (district) filter.district = district;
  return Camp.find(filter).sort({ createdAt: -1 });
}

export async function getCampById(campId) {
  const camp = await Camp.findById(campId);
  if (!camp) throw AppError.notFound('No camp with that id.');
  return camp;
}

export async function updateCamp(campId, input, { actorId, actorRole, ip }) {
  const camp = await getCampById(campId);
  const before = camp.toSafeJSON();

  const { latitude, longitude, ...rest } = input;
  Object.assign(camp, rest);
  if (latitude !== undefined && longitude !== undefined) {
    camp.location = { type: 'Point', coordinates: [longitude, latitude] };
  }
  recomputeStatus(camp);
  await camp.save();

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'camp.update',
    module: 'camps', record_id: camp._id, before, after: camp.toSafeJSON(), ip,
  });

  broadcastOccupancy(camp);
  return camp;
}

/**
 * Reserve N beneficiary slots atomically. Returns the updated camp, or
 * `null` if reserving N more would exceed capacity — the compare-and-swap
 * spec section 5.3 requires so two concurrent registrations for the last
 * bed cannot both succeed. Accepts an optional session so an enclosing
 * transaction (Plan 3's registration flow) rolls this back together with
 * everything else if a later step fails.
 */
export async function reserveBeneficiarySlots(campId, n, session) {
  const camp = await Camp.findOneAndUpdate(
    {
      _id: campId,
      $expr: { $lte: [{ $add: ['$beneficiaries_accepted', n] }, '$beneficiary_capacity'] },
    },
    { $inc: { beneficiaries_accepted: n } },
    { new: true, session }
  );
  if (!camp) return null;

  recomputeStatus(camp);
  await camp.save({ session });
  broadcastOccupancy(camp);
  return camp;
}

/**
 * Camps with remaining beneficiary capacity, closest to the given point
 * first. Feeds both the landing page and, from Plan 3 onward, the 409
 * "nearest camp" recommendation when a chosen camp is full (spec §5.3).
 */
export async function findNearestOpenCamps({ latitude, longitude, excludeCampId, limit = 5 }) {
  const query = {
    $expr: { $lt: ['$beneficiaries_accepted', '$beneficiary_capacity'] },
    status: { $in: ['open', 'nearly_full'] },
  };
  if (excludeCampId) query._id = { $ne: new mongoose.Types.ObjectId(excludeCampId) };

  return Camp.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [longitude, latitude] },
        distanceField: 'distance_meters',
        spherical: true,
        query,
      },
    },
    { $limit: limit },
  ]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace server`
Expected: PASS — 9 new tests. The race test occasionally takes longer than
the others — both calls genuinely hit MongoDB concurrently.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/camps/camps.service.js server/src/modules/camps/camps.service.test.js
git commit -m "$(cat <<'EOF'
feat: add camps service with the atomic capacity guard

reserveBeneficiarySlots is spec section 5.3's compare-and-swap, verbatim:
the $expr filter and $inc update happen as one atomic MongoDB operation,
so two concurrent reservations for the last bed cannot both succeed. The
test proves this by actually racing two calls with Promise.all rather than
reasoning about the code — a race test that never contends proves nothing.

Every mutation broadcasts camp:occupancy over the socket core Task 4 adds,
and every write goes through recordAudit with before/after values.

findNearestOpenCamps exists now, even though Plan 3's intake is its only
real caller (the 409 "nearest camp" recommendation), because camps/ owns
the query per the module-ownership rule — not intake.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Camps API routes

**Files:**
- Modify: `shared/src/schemas/camp.schema.js`, `server/src/app.js`
- Create: `server/src/modules/camps/{camps.controller.js,camps.routes.js}`
- Test: `server/src/modules/camps/camps.test.js`

**Interfaces:**
- Consumes: everything from Tasks 3 and 5
- Produces: `POST /api/camps`, `GET /api/camps`, `GET /api/camps/:id`, `PATCH /api/camps/:id`, `GET /api/camps/nearest`

**Route ordering matters:** `/camps/nearest` is registered before `/camps/:id`
— Express matches routes in declaration order, and `:id` would otherwise
swallow the literal `nearest` segment.

- [ ] **Step 1: Add the nearest-camp query schema**

Modify `shared/src/schemas/camp.schema.js` — export `objectId` (it was
module-private) and add:

```js
export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id.');
```

(replace the existing unexported `const objectId = ...` line with this
exported version), then add at the end of the file:

```js
export const nearestCampQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  excludeCampId: objectId.optional(),
});
```

- [ ] **Step 2: Write the failing test**

Create `server/src/modules/camps/camps.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role) {
  return User.create({
    name: 'Test', mobile: String(9200000000 + Math.floor(Math.random() * 799999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active',
  });
}
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

const campBody = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7,
  flood_severity: 'high',
  beneficiary_capacity: 400, volunteer_capacity: 30, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

describe('POST /api/camps', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin create a camp', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    expect(res.status).toBe(201);
    expect(res.body.camp).toMatchObject({ name: 'Riverside Community Hall', status: 'open' });
  });

  it('refuses a camp official', async () => {
    const official = await makeUser('camp_official');
    const res = await request(app).post('/api/camps').set(bearer(official)).send(campBody());
    expect(res.status).toBe(403);
  });

  it('validates missing mandatory fields', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).post('/api/camps').set(bearer(admin)).send(campBody({ beneficiary_capacity: undefined }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/camps', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lists camps for any authenticated role, including affected_person', async () => {
    const admin = await makeUser('admin');
    await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const person = await makeUser('affected_person');
    const res = await request(app).get('/api/camps').set(bearer(person));
    expect(res.status).toBe(200);
    expect(res.body.camps).toHaveLength(1);
  });

  it('filters by status', async () => {
    const admin = await makeUser('admin');
    await request(app).post('/api/camps').set(bearer(admin)).send(campBody({ name: 'A' }));
    const res = await request(app).get('/api/camps?status=open').set(bearer(admin));
    expect(res.body.camps).toHaveLength(1);
    const none = await request(app).get('/api/camps?status=closed').set(bearer(admin));
    expect(none.body.camps).toHaveLength(0);
  });
});

describe('GET /api/camps/:id', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('returns one camp', async () => {
    const admin = await makeUser('admin');
    const created = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const res = await request(app).get(`/api/camps/${created.body.camp.id}`).set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.camp.id).toBe(created.body.camp.id);
  });

  it('404s for an unknown id', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).get('/api/camps/000000000000000000000000').set(bearer(admin));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/camps/:id', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin close a camp', async () => {
    const admin = await makeUser('admin');
    const created = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const res = await request(app)
      .patch(`/api/camps/${created.body.camp.id}`)
      .set(bearer(admin))
      .send({ admin_override: 'closed' });
    expect(res.status).toBe(200);
    expect(res.body.camp.status).toBe('closed');
  });

  it('refuses a donor', async () => {
    const admin = await makeUser('admin');
    const created = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const donor = await makeUser('donor');
    const res = await request(app)
      .patch(`/api/camps/${created.body.camp.id}`)
      .set(bearer(donor))
      .send({ admin_override: 'closed' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/camps/nearest', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('returns nearby camps with remaining capacity', async () => {
    const admin = await makeUser('admin');
    await request(app).post('/api/camps').set(bearer(admin)).send(campBody({ name: 'Near', latitude: 26.2, longitude: 91.7 }));
    const res = await request(app).get('/api/camps/nearest?latitude=26.2&longitude=91.7').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.camps[0].name).toBe('Near');
  });

  it('validates that latitude/longitude are provided', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).get('/api/camps/nearest').set(bearer(admin));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — 404s across the board, no `/api/camps` routes mounted.

- [ ] **Step 4: Implement the controller**

Create `server/src/modules/camps/camps.controller.js`:

```js
import * as campsService from './camps.service.js';

export async function createCampHandler(req, res) {
  const camp = await campsService.createCamp(req.body, { actorId: req.user.id, actorRole: req.user.role, ip: req.ip });
  res.status(201).json({ camp: camp.toSafeJSON() });
}

export async function listCampsHandler(req, res) {
  const { status, district } = req.query;
  const camps = await campsService.listCamps({ status, district });
  res.json({ camps: camps.map((c) => c.toSafeJSON()) });
}

export async function getCampHandler(req, res) {
  const camp = await campsService.getCampById(req.params.id);
  res.json({ camp: camp.toSafeJSON() });
}

export async function updateCampHandler(req, res) {
  const camp = await campsService.updateCamp(req.params.id, req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.json({ camp: camp.toSafeJSON() });
}

export async function nearestCampsHandler(req, res) {
  const { latitude, longitude, excludeCampId } = req.query;
  const results = await campsService.findNearestOpenCamps({ latitude, longitude, excludeCampId });
  res.json({
    camps: results.map((c) => ({
      id: c._id.toString(), name: c.name, district: c.district, status: c.status,
      beneficiary_capacity: c.beneficiary_capacity, beneficiaries_accepted: c.beneficiaries_accepted,
      distance_meters: Math.round(c.distance_meters),
    })),
  });
}
```

- [ ] **Step 5: Implement the routes**

Create `server/src/modules/camps/camps.routes.js`:

```js
import { Router } from 'express';
import { createCampSchema, updateCampSchema, nearestCampQuerySchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  createCampHandler, listCampsHandler, getCampHandler, updateCampHandler, nearestCampsHandler,
} from './camps.controller.js';

export const campsRouter = Router();

// /nearest before /:id — Express matches in declaration order and :id would
// otherwise swallow the literal "nearest" segment.
campsRouter.get('/camps/nearest', authenticate, validate(nearestCampQuerySchema, 'query'), nearestCampsHandler);
campsRouter.post('/camps', authenticate, authorize('admin'), validate(createCampSchema), createCampHandler);
campsRouter.get('/camps', authenticate, listCampsHandler);
campsRouter.get('/camps/:id', authenticate, getCampHandler);
campsRouter.patch('/camps/:id', authenticate, authorize('admin'), validate(updateCampSchema), updateCampHandler);
```

Modify `server/src/app.js` — add the import and mount alongside `areasRouter`:

```js
import { campsRouter } from './modules/camps/camps.routes.js';
// ...
app.use('/api', campsRouter);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace server`
Expected: PASS — 10 new tests.

- [ ] **Step 7: Commit**

```bash
git add shared/ server/
git commit -m "$(cat <<'EOF'
feat: add camps API routes

Create and update are admin-only (requirements section 6.3: "Admin can
create, view, edit, activate/deactivate, close, and monitor camps"); list
and get are open to any authenticated role, since affected persons and
donors both need to see camps on the landing page. /camps/nearest is
registered ahead of /camps/:id — Express matches routes in declaration
order, and :id would otherwise swallow the literal "nearest" segment.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Client socket connection

**Files:**
- Modify: `client/vite.config.js`
- Create: `client/src/api/socket.js`
- Test: `client/src/api/socket.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `useLiveCampUpdates(): void` — subscribe-on-mount, unsubscribe-on-unmount hook

**Per spec §7.3:** the socket handler never writes camp data into state
directly — it only calls `invalidateQueries(['camps'])`, so a pushed update
and a manual refetch are indistinguishable to every component reading the
`camps` query.

- [ ] **Step 1: Install the client dependency and proxy Socket.IO in dev**

```bash
npm install socket.io-client --workspace client
```

Modify `client/vite.config.js` — add a second proxy entry alongside `/api`:

```js
proxy: {
  '/api': { target: 'http://localhost:4000', changeOrigin: true },
  '/socket.io': { target: 'http://localhost:4000', ws: true, changeOrigin: true },
},
```

- [ ] **Step 2: Write the failing test**

Create `client/src/api/socket.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const handlers = {};
const mockSocket = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn((event, cb) => { handlers[event] = cb; }),
  off: vi.fn(),
};

vi.mock('socket.io-client', () => ({ io: () => mockSocket }));

describe('useLiveCampUpdates', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('connects on mount and invalidates the camps query when an occupancy event arrives', async () => {
    const { useLiveCampUpdates } = await import('./socket.js');
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

    renderHook(() => useLiveCampUpdates(), { wrapper });

    expect(mockSocket.connect).toHaveBeenCalled();
    handlers['camp:occupancy']({ campId: 'abc' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['camps'] });
  });

  it('disconnects on unmount', async () => {
    const { useLiveCampUpdates } = await import('./socket.js');
    const qc = new QueryClient();
    const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

    const { unmount } = renderHook(() => useLiveCampUpdates(), { wrapper });
    unmount();
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --workspace client`
Expected: FAIL — cannot resolve `./socket.js`.

- [ ] **Step 4: Implement it**

Create `client/src/api/socket.js`:

```jsx
import { io } from 'socket.io-client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Same origin in dev — vite.config.js proxies /socket.io to the API server
// alongside /api, so the browser never needs a separate host or port.
const socket = io({ autoConnect: false });

/**
 * Subscribe to camp:occupancy for the lifetime of the calling component.
 * On receipt this only invalidates the `camps` query key, per spec section
 * 7.3 — it never writes camp data into state directly, so a pushed update
 * and a manual refetch are indistinguishable to anything reading that query.
 */
export function useLiveCampUpdates() {
  const qc = useQueryClient();

  useEffect(() => {
    socket.connect();
    const onOccupancy = () => qc.invalidateQueries({ queryKey: ['camps'] });
    socket.on('camp:occupancy', onOccupancy);
    return () => {
      socket.off('camp:occupancy', onOccupancy);
      socket.disconnect();
    };
  }, [qc]);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace client`
Expected: PASS — 2 new tests.

- [ ] **Step 6: Commit**

```bash
git add client/
git commit -m "$(cat <<'EOF'
feat: add client Socket.IO connection with query-invalidation pattern

useLiveCampUpdates() only calls invalidateQueries(['camps']) on receipt —
per spec section 7.3, it never writes camp data into state directly, so a
pushed live update and an ordinary refetch are indistinguishable to
anything reading that query.

/socket.io is proxied alongside /api in dev, so the browser talks to one
origin regardless of which port actually serves the request.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Admin — affected areas screen

**Files:**
- Create: `client/src/api/areas.js`, `client/src/components/StatusBadge.jsx`
- Create: `client/src/features/admin/areas/AreasPage.jsx`
- Modify: `client/src/App.jsx`
- Test: `client/src/features/admin/areas/AreasPage.test.jsx`

**Interfaces:**
- Consumes: `GET /api/areas`, `POST /api/areas` (Task 2)
- Produces: `<StatusBadge tone="ok"|"warn"|"bad"|"neutral"|"brand">`, `useAreas()`, `useCreateArea()`, `<AreasPage>`

`StatusBadge` is deliberately generic and tone-keyed rather than
area-specific — the design brief's screen inventory uses the exact same
colored-pill treatment for area severity, camp status, priority, and
volunteer state. One component now saves rebuilding it four times over
the next two plans.

- [ ] **Step 1: Write the failing test**

Create `client/src/features/admin/areas/AreasPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AreasPage } from './AreasPage.jsx';
import { api } from '../../../api/client.js';

vi.mock('../../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AreasPage /></QueryClientProvider>);
}

describe('AreasPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists existing areas', async () => {
    api.get.mockResolvedValue({
      data: { areas: [{ id: '1', name: 'Ward 12', district: 'North District', state: 'Assam', severity: 'high' }] },
    });
    renderPage();
    expect(await screen.findByText('Ward 12')).toBeInTheDocument();
  });

  it('submits a new area', async () => {
    api.get.mockResolvedValue({ data: { areas: [] } });
    api.post.mockResolvedValue({ data: { area: { id: '2', name: 'Ward 5' } } });
    renderPage();
    await screen.findByText(/no affected areas recorded yet/i);

    await userEvent.type(screen.getByLabelText(/area name/i), 'Ward 5');
    await userEvent.type(screen.getByLabelText(/district/i), 'East District');
    await userEvent.type(screen.getByLabelText(/^state/i), 'Assam');
    await userEvent.type(screen.getByLabelText(/address/i), 'Near canal');
    await userEvent.type(screen.getByLabelText(/latitude/i), '26.1');
    await userEvent.type(screen.getByLabelText(/longitude/i), '91.6');
    await userEvent.click(screen.getByRole('button', { name: /record area/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/areas', expect.objectContaining({ name: 'Ward 5' })));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client`
Expected: FAIL — cannot resolve `./AreasPage.jsx`.

- [ ] **Step 3: Implement the shared badge**

Create `client/src/components/StatusBadge.jsx`:

```jsx
import { Box } from '@mui/material';

const TONES = {
  ok: { bg: '#E9F7EE', fg: '#1E8E4A' },
  warn: { bg: '#FEF6E7', fg: '#8A5B0C' },
  bad: { bg: '#FDECEA', fg: '#C0392B' },
  neutral: { bg: '#F2F2F2', fg: '#6B6B6B' },
  brand: { bg: '#FFF0E4', fg: '#C44E00' },
};

/** The colored-pill badge used across the design for status, severity, and priority. */
export function StatusBadge({ tone = 'neutral', children }) {
  const { bg, fg } = TONES[tone] ?? TONES.neutral;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block', px: 1.25, py: 0.4, borderRadius: '20px',
        fontSize: 11, fontWeight: 600, bgcolor: bg, color: fg, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}
```

- [ ] **Step 4: Implement the API hooks**

Create `client/src/api/areas.js`:

```js
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useAreas() {
  return useQuery({ queryKey: ['areas'], queryFn: async () => (await api.get('/areas')).data.areas });
}

export function useActiveAlerts() {
  return useQuery({ queryKey: ['alerts', 'active'], queryFn: async () => (await api.get('/alerts/active')).data.alerts });
}

export function useCreateArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/areas', payload)).data.area,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['areas'] }),
  });
}
```

- [ ] **Step 5: Implement the page**

Create `client/src/features/admin/areas/AreasPage.jsx`:

```jsx
import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { createAreaSchema } from '@frp/shared';
import { useAreas, useCreateArea } from '../../../api/areas.js';
import { StatusBadge } from '../../../components/StatusBadge.jsx';
import { toFormErrors } from '../../../api/client.js';

const SEVERITY_TONE = { low: 'ok', medium: 'warn', high: 'bad', critical: 'bad' };
const SEVERITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

export function AreasPage() {
  const { data: areas = [], isLoading } = useAreas();
  const createArea = useCreateArea();
  const [values, setValues] = useState({
    name: '', district: '', state: '', address: '', latitude: '', longitude: '', severity: 'medium',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);

  const change = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setFormError(null);
    const parsed = createAreaSchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setFieldErrors({});
    try {
      await createArea.mutateAsync(parsed.data);
      setValues({ name: '', district: '', state: '', address: '', latitude: '', longitude: '', severity: 'medium' });
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setFormError(message);
      setFieldErrors(fields);
    }
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.3fr 1fr' }, gap: 3 }}>
      <Box>
        <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>
          Flood-affected areas
        </Typography>
        <Stack spacing={1.5}>
          {areas.map((area) => (
            <Card key={area.id}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>{area.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{area.district}, {area.state}</Typography>
                </Box>
                <StatusBadge tone={SEVERITY_TONE[area.severity]}>{SEVERITY_LABEL[area.severity]}</StatusBadge>
              </CardContent>
            </Card>
          ))}
          {!isLoading && areas.length === 0 && (
            <Typography color="text.secondary">No affected areas recorded yet.</Typography>
          )}
        </Stack>
      </Box>

      <Card>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Record affected area</Typography>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Box component="form" onSubmit={onSubmit} noValidate>
            <TextField label="Area name" value={values.name} onChange={change('name')}
              error={Boolean(fieldErrors.name)} helperText={fieldErrors.name} />
            <TextField label="District" value={values.district} onChange={change('district')}
              error={Boolean(fieldErrors.district)} helperText={fieldErrors.district} />
            <TextField label="State" value={values.state} onChange={change('state')}
              error={Boolean(fieldErrors.state)} helperText={fieldErrors.state} />
            <TextField label="Address / location description" value={values.address} onChange={change('address')}
              error={Boolean(fieldErrors.address)} helperText={fieldErrors.address} />
            <Stack direction="row" spacing={2}>
              <TextField label="Latitude" value={values.latitude} onChange={change('latitude')}
                error={Boolean(fieldErrors.latitude)} helperText={fieldErrors.latitude} />
              <TextField label="Longitude" value={values.longitude} onChange={change('longitude')}
                error={Boolean(fieldErrors.longitude)} helperText={fieldErrors.longitude} />
            </Stack>
            <TextField select label="Severity" value={values.severity} onChange={change('severity')}>
              <MenuItem value="low">Low</MenuItem>
              <MenuItem value="medium">Medium</MenuItem>
              <MenuItem value="high">High</MenuItem>
              <MenuItem value="critical">Critical</MenuItem>
            </TextField>
            <Button type="submit" variant="contained" fullWidth disabled={createArea.isPending} sx={{ mt: 2 }}>
              {createArea.isPending ? 'Recording…' : 'Record area'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace client`
Expected: PASS — 2 new tests.

- [ ] **Step 7: Wire the route**

Modify `client/src/App.jsx` — import `AreasPage` and add a route inside the
existing `admin`-role `<RequireAuth roles={['admin']}>` block, alongside
`/admin`:

```jsx
import { AreasPage } from './features/admin/areas/AreasPage.jsx';
// ...
<Route path="/admin/areas" element={<AreasPage />} />
```

- [ ] **Step 8: Commit**

```bash
git add client/
git commit -m "$(cat <<'EOF'
feat: add admin affected-areas screen

StatusBadge is a shared, tone-keyed pill component rather than
area-specific — the design's screen inventory reuses the identical
colored-pill treatment for severity, camp status, priority, and volunteer
state, so building it generically now saves rebuilding it three more
times across Plans 3 and 4.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Admin — camps list and create-camp form

**Files:**
- Create: `client/src/api/camps.js`
- Create: `client/src/features/admin/camps/{CampsListPage.jsx,CreateCampPage.jsx}`
- Modify: `client/src/App.jsx`
- Test: `client/src/features/admin/camps/{CampsListPage.test.jsx,CreateCampPage.test.jsx}`

**Interfaces:**
- Consumes: `GET /api/camps`, `POST /api/camps` (Task 6), `useLiveCampUpdates` (Task 7), `StatusBadge` (Task 8)
- Produces: `useCamps(params)`, `useCamp(id)`, `useCreateCamp()`, `<CampsListPage>`, `<CreateCampPage>`

Layout uses CSS grid via `Box sx={{display:'grid', ...}}` rather than MUI's
`<Grid>` component — the same choice Plan 1's auth screens made, since it
sidesteps any ambiguity about which `Grid` API a given MUI version ships.

- [ ] **Step 1: Write the failing tests**

Create `client/src/features/admin/camps/CampsListPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CampsListPage } from './CampsListPage.jsx';
import { api } from '../../../api/client.js';

vi.mock('../../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});
vi.mock('socket.io-client', () => ({ io: () => ({ connect: vi.fn(), disconnect: vi.fn(), on: vi.fn(), off: vi.fn() }) }));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><CampsListPage /></MemoryRouter></QueryClientProvider>);
}

describe('CampsListPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists camps with occupancy and status', async () => {
    api.get.mockResolvedValue({
      data: { camps: [{
        id: '1', name: 'Riverside Community Hall', area: 'Ward 12', district: 'North District',
        camp_type: 'community_hall', beneficiary_capacity: 400, beneficiaries_accepted: 240,
        volunteer_capacity: 30, volunteers_accepted: 28, duration_days: 14,
        status: 'open', assigned_official_id: null,
      }] },
    });
    renderPage();
    expect(await screen.findByText('Riverside Community Hall')).toBeInTheDocument();
    expect(screen.getByText('240 / 400')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('shows an empty state with no camps', async () => {
    api.get.mockResolvedValue({ data: { camps: [] } });
    renderPage();
    expect(await screen.findByText(/no camps yet/i)).toBeInTheDocument();
  });
});
```

Create `client/src/features/admin/camps/CreateCampPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateCampPage } from './CreateCampPage.jsx';
import { api } from '../../../api/client.js';

vi.mock('../../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, post: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><CreateCampPage /></MemoryRouter></QueryClientProvider>);
}

describe('CreateCampPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('validates before sending anything to the server', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /create & open camp/i }));
    expect(await screen.findByText(/camp name is required/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('submits a complete camp', async () => {
    api.post.mockResolvedValue({ data: { camp: { id: '1', name: 'Test Camp' } } });
    renderPage();

    await userEvent.type(screen.getByLabelText(/camp name/i), 'Test Camp');
    await userEvent.type(screen.getByLabelText(/^address/i), '12 River Road');
    await userEvent.type(screen.getByLabelText(/^area/i), 'Ward 12');
    await userEvent.type(screen.getByLabelText(/^district/i), 'North District');
    await userEvent.type(screen.getByLabelText(/^state/i), 'Assam');
    await userEvent.type(screen.getByLabelText(/pincode/i), '781001');
    await userEvent.type(screen.getByLabelText(/latitude/i), '26.2');
    await userEvent.type(screen.getByLabelText(/longitude/i), '91.7');
    await userEvent.type(screen.getByLabelText(/beneficiary capacity/i), '400');
    await userEvent.type(screen.getByLabelText(/volunteer capacity/i), '30');
    await userEvent.type(screen.getByLabelText(/duration/i), '14');
    await userEvent.type(screen.getByLabelText(/nearest hospital name/i), 'District Hospital');
    await userEvent.type(screen.getByLabelText(/nearest hospital contact/i), '0484-2000000');
    await userEvent.type(screen.getByLabelText(/nearest police station/i), 'Ward 12 Police Station');
    await userEvent.type(screen.getByLabelText(/nearest police contact/i), '0484-2100000');

    await userEvent.click(screen.getByRole('button', { name: /create & open camp/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/camps', expect.objectContaining({ name: 'Test Camp', beneficiary_capacity: 400 }))
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace client`
Expected: FAIL — cannot resolve `./CampsListPage.jsx` / `./CreateCampPage.jsx`.

- [ ] **Step 3: Implement the API hooks**

Create `client/src/api/camps.js`:

```js
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useCamps(params = {}) {
  return useQuery({
    queryKey: ['camps', params],
    queryFn: async () => (await api.get('/camps', { params })).data.camps,
  });
}

export function useCamp(id) {
  return useQuery({
    queryKey: ['camps', 'detail', id],
    queryFn: async () => (await api.get(`/camps/${id}`)).data.camp,
    enabled: Boolean(id),
  });
}

export function useCreateCamp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/camps', payload)).data.camp,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['camps'] }),
  });
}
```

- [ ] **Step 4: Implement the camps list**

Create `client/src/features/admin/camps/CampsListPage.jsx`:

```jsx
import { useState } from 'react';
import {
  Box, Button, MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useCamps } from '../../../api/camps.js';
import { useLiveCampUpdates } from '../../../api/socket.js';
import { StatusBadge } from '../../../components/StatusBadge.jsx';

const STATUS_TONE = { open: 'ok', nearly_full: 'warn', full: 'bad', temporarily_closed: 'neutral', closed: 'neutral' };
const STATUS_LABEL = {
  open: 'Open', nearly_full: 'Nearly Full', full: 'Full',
  temporarily_closed: 'Temporarily Closed', closed: 'Closed',
};

export function CampsListPage() {
  useLiveCampUpdates();
  const [status, setStatus] = useState('');
  const { data: camps = [], isLoading } = useCamps(status ? { status } : {});

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>Camps</Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All statuses</MenuItem>
            {Object.entries(STATUS_LABEL).map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}
          </TextField>
          <Button component={RouterLink} to="/admin/camps/new" variant="contained">+ Create camp</Button>
        </Box>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Camp</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Occupied</TableCell>
              <TableCell>Volunteers</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell>Official</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {camps.map((camp) => (
              <TableRow key={camp.id}>
                <TableCell>
                  <Typography sx={{ fontWeight: 600 }}>{camp.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{camp.area}, {camp.district}</Typography>
                </TableCell>
                <TableCell>{camp.camp_type.replace('_', ' ')}</TableCell>
                <TableCell>{camp.beneficiaries_accepted} / {camp.beneficiary_capacity}</TableCell>
                <TableCell>{camp.volunteers_accepted} / {camp.volunteer_capacity}</TableCell>
                <TableCell>{camp.duration_days} days</TableCell>
                <TableCell>
                  <StatusBadge tone={camp.assigned_official_id ? 'ok' : 'neutral'}>
                    {camp.assigned_official_id ? 'Assigned' : 'Unassigned'}
                  </StatusBadge>
                </TableCell>
                <TableCell><StatusBadge tone={STATUS_TONE[camp.status]}>{STATUS_LABEL[camp.status]}</StatusBadge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {!isLoading && camps.length === 0 && (
        <Typography color="text.secondary" sx={{ mt: 3 }}>No camps yet. Create the first one.</Typography>
      )}
    </Box>
  );
}
```

- [ ] **Step 5: Implement the create-camp form**

Create `client/src/features/admin/camps/CreateCampPage.jsx`:

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material';
import { createCampSchema } from '@frp/shared';
import { useCreateCamp } from '../../../api/camps.js';
import { toFormErrors } from '../../../api/client.js';

const FACILITY_FIELDS = [
  ['food', 'Food'], ['drinking_water', 'Drinking water'], ['medical_support', 'Medical support'],
  ['electricity', 'Electricity'], ['accommodation', 'Accommodation'], ['charging_points', 'Charging points'],
  ['internet', 'Internet'], ['child_care', 'Child care'], ['womens_facilities', "Women's facilities"],
  ['disability_friendly', 'Disability-friendly'],
];

const twoCol = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 };

const initialValues = {
  name: '', camp_type: 'community_hall', description: '',
  address: '', area: '', district: '', state: '', pincode: '', latitude: '', longitude: '',
  flood_severity: 'medium',
  beneficiary_capacity: '', volunteer_capacity: '', duration_days: '',
  facilities: {
    food: false, drinking_water: false, medical_support: false, toilets_count: '0',
    electricity: false, accommodation: false, charging_points: false, internet: false,
    child_care: false, womens_facilities: false, disability_friendly: false,
  },
  nearest_hospital_name: '', nearest_hospital_contact: '',
  nearest_police_name: '', nearest_police_contact: '',
};

export function CreateCampPage() {
  const navigate = useNavigate();
  const createCamp = useCreateCamp();
  const [values, setValues] = useState(initialValues);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);

  const change = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }));
  const toggleFacility = (f) => (e) =>
    setValues((v) => ({ ...v, facilities: { ...v.facilities, [f]: e.target.checked } }));

  async function onSubmit(e) {
    e.preventDefault();
    setFormError(null);
    const parsed = createCampSchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setFieldErrors({});
    try {
      await createCamp.mutateAsync(parsed.data);
      navigate('/admin/camps');
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setFormError(message);
      setFieldErrors(fields);
    }
  }

  return (
    <Box component="form" onSubmit={onSubmit} noValidate sx={{ maxWidth: 860 }}>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 3 }}>
        Create a relief camp
      </Typography>
      {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Identity</Typography>
          <TextField label="Camp name" value={values.name} onChange={change('name')}
            error={Boolean(fieldErrors.name)} helperText={fieldErrors.name} />
          <TextField select label="Camp type" value={values.camp_type} onChange={change('camp_type')}>
            <MenuItem value="school">School</MenuItem>
            <MenuItem value="auditorium">Auditorium</MenuItem>
            <MenuItem value="community_hall">Community Hall</MenuItem>
            <MenuItem value="other">Other</MenuItem>
          </TextField>
          <TextField label="Description" value={values.description} onChange={change('description')} multiline minRows={2} />
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Location &amp; flood context</Typography>
          <TextField label="Address" value={values.address} onChange={change('address')}
            error={Boolean(fieldErrors.address)} helperText={fieldErrors.address} />
          <Box sx={twoCol}>
            <TextField label="Area" value={values.area} onChange={change('area')}
              error={Boolean(fieldErrors.area)} helperText={fieldErrors.area} />
            <TextField label="District" value={values.district} onChange={change('district')}
              error={Boolean(fieldErrors.district)} helperText={fieldErrors.district} />
            <TextField label="State" value={values.state} onChange={change('state')}
              error={Boolean(fieldErrors.state)} helperText={fieldErrors.state} />
            <TextField label="Pincode" value={values.pincode} onChange={change('pincode')}
              error={Boolean(fieldErrors.pincode)} helperText={fieldErrors.pincode} />
            <TextField label="Latitude" value={values.latitude} onChange={change('latitude')}
              error={Boolean(fieldErrors.latitude)} helperText={fieldErrors.latitude} />
            <TextField label="Longitude" value={values.longitude} onChange={change('longitude')}
              error={Boolean(fieldErrors.longitude)} helperText={fieldErrors.longitude} />
          </Box>
          <TextField select label="Flood severity" value={values.flood_severity} onChange={change('flood_severity')}>
            <MenuItem value="low">Low</MenuItem>
            <MenuItem value="medium">Medium</MenuItem>
            <MenuItem value="high">High</MenuItem>
            <MenuItem value="critical">Critical</MenuItem>
          </TextField>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Capacity &amp; duration</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
            <TextField label="Beneficiary capacity" value={values.beneficiary_capacity} onChange={change('beneficiary_capacity')}
              error={Boolean(fieldErrors.beneficiary_capacity)} helperText={fieldErrors.beneficiary_capacity} />
            <TextField label="Volunteer capacity" value={values.volunteer_capacity} onChange={change('volunteer_capacity')}
              error={Boolean(fieldErrors.volunteer_capacity)} helperText={fieldErrors.volunteer_capacity} />
            <TextField label="Duration (days)" value={values.duration_days} onChange={change('duration_days')}
              error={Boolean(fieldErrors.duration_days)} helperText={fieldErrors.duration_days} />
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 1 }}>Facilities</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr' }, gap: 0.5 }}>
            {FACILITY_FIELDS.map(([key, label]) => (
              <FormControlLabel
                key={key}
                control={<Checkbox checked={values.facilities[key]} onChange={toggleFacility(key)} />}
                label={label}
              />
            ))}
          </Box>
          <TextField
            label="Toilets (count)" value={values.facilities.toilets_count} sx={{ maxWidth: 200 }}
            onChange={(e) => setValues((v) => ({ ...v, facilities: { ...v.facilities, toilets_count: e.target.value } }))}
          />
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Emergency contacts</Typography>
          <Box sx={twoCol}>
            <TextField label="Nearest hospital name" value={values.nearest_hospital_name} onChange={change('nearest_hospital_name')}
              error={Boolean(fieldErrors.nearest_hospital_name)} helperText={fieldErrors.nearest_hospital_name} />
            <TextField label="Nearest hospital contact" value={values.nearest_hospital_contact} onChange={change('nearest_hospital_contact')}
              error={Boolean(fieldErrors.nearest_hospital_contact)} helperText={fieldErrors.nearest_hospital_contact} />
            <TextField label="Nearest police station" value={values.nearest_police_name} onChange={change('nearest_police_name')}
              error={Boolean(fieldErrors.nearest_police_name)} helperText={fieldErrors.nearest_police_name} />
            <TextField label="Nearest police contact" value={values.nearest_police_contact} onChange={change('nearest_police_contact')}
              error={Boolean(fieldErrors.nearest_police_contact)} helperText={fieldErrors.nearest_police_contact} />
          </Box>
          <Alert severity="warning" sx={{ mt: 2 }}>
            Medical SOS routes to the hospital contact and security SOS to the police contact — both are required before the camp can open.
          </Alert>
        </CardContent>
      </Card>

      <Button type="submit" variant="contained" size="large" disabled={createCamp.isPending}>
        {createCamp.isPending ? 'Creating…' : 'Create & open camp'}
      </Button>
    </Box>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace client`
Expected: PASS — 4 new tests.

- [ ] **Step 7: Wire the routes**

Modify `client/src/App.jsx` — import both pages and add two more routes
inside the existing admin `<RequireAuth roles={['admin']}>` block:

```jsx
import { CampsListPage } from './features/admin/camps/CampsListPage.jsx';
import { CreateCampPage } from './features/admin/camps/CreateCampPage.jsx';
// ...
<Route path="/admin/camps" element={<CampsListPage />} />
<Route path="/admin/camps/new" element={<CreateCampPage />} />
```

- [ ] **Step 8: Commit**

```bash
git add client/
git commit -m "$(cat <<'EOF'
feat: add admin camps list and create-camp form

The create form is sectioned exactly as requirements section 6.3 groups
its fields — Identity, Location & flood context, Capacity & duration,
Facilities, Emergency contacts — with both emergency contacts required and
a callout explaining why, matching the design's own warning copy.

Layout uses CSS grid via Box sx rather than MUI's Grid component, the
same choice Plan 1's auth screens made, to avoid depending on which Grid
API a given MUI version ships.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Public landing page

**Files:**
- Create: `client/src/features/landing/LandingPage.jsx`
- Modify: `client/src/App.jsx`
- Test: `client/src/features/landing/LandingPage.test.jsx`

**Interfaces:**
- Consumes: `useCamps`, `useActiveAlerts`, `useLiveCampUpdates`, `StatusBadge`
- Produces: `<LandingPage>`

**Spec §6.2** requires this page for both Affected Person and Donor, so it
becomes the shared handler for both `/` and `/donor` — a donor-specific
dashboard is Group F territory, not built yet. The "Register for camp"
button is never a dead click: it navigates to a real stub route rather than
doing nothing, because requirements §13's "must not silently lose entered
data" extends to "must not silently do nothing" — a button that appears to
work but doesn't is worse than one that is honestly disabled.

- [ ] **Step 1: Write the failing test**

Create `client/src/features/landing/LandingPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LandingPage } from './LandingPage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});
vi.mock('socket.io-client', () => ({ io: () => ({ connect: vi.fn(), disconnect: vi.fn(), on: vi.fn(), off: vi.fn() }) }));

const campFixture = (over = {}) => ({
  id: '1', name: 'Riverside Community Hall', area: 'Ward 12', district: 'North District',
  beneficiary_capacity: 400, beneficiaries_accepted: 240,
  volunteer_capacity: 30, volunteers_accepted: 28,
  status: 'open', facilities: { food: true, drinking_water: true }, ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><LandingPage /></MemoryRouter></QueryClientProvider>);
}

describe('LandingPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the flood alert banner when active alerts exist', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/camps') return Promise.resolve({ data: { camps: [] } });
      if (url === '/alerts/active') return Promise.resolve({ data: { alerts: [{ area_name: 'Ward 12', message: 'Water rising fast.' }] } });
      return Promise.resolve({ data: {} });
    });
    renderPage();
    expect(await screen.findByText(/water rising fast/i)).toBeInTheDocument();
  });

  it('lists camps with a live occupancy figure', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/camps') return Promise.resolve({ data: { camps: [campFixture()] } });
      return Promise.resolve({ data: { alerts: [] } });
    });
    renderPage();
    expect(await screen.findByText('Riverside Community Hall')).toBeInTheDocument();
    expect(screen.getByText('240 / 400')).toBeInTheDocument();
  });

  it('disables the register button for a full camp', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/camps') return Promise.resolve({ data: { camps: [campFixture({ status: 'full', beneficiaries_accepted: 400 })] } });
      return Promise.resolve({ data: { alerts: [] } });
    });
    renderPage();
    expect(await screen.findByRole('button', { name: /camp full/i })).toBeDisabled();
  });

  it('filters camps by search text', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/camps') {
        return Promise.resolve({
          data: { camps: [campFixture(), campFixture({ id: '2', name: 'Central Auditorium', area: 'Ward 3' })] },
        });
      }
      return Promise.resolve({ data: { alerts: [] } });
    });
    renderPage();
    await screen.findByText('Riverside Community Hall');
    await userEvent.type(screen.getByPlaceholderText(/search camp or area/i), 'Auditorium');
    expect(screen.queryByText('Riverside Community Hall')).not.toBeInTheDocument();
    expect(screen.getByText('Central Auditorium')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client`
Expected: FAIL — cannot resolve `./LandingPage.jsx`.

- [ ] **Step 3: Implement it**

Create `client/src/features/landing/LandingPage.jsx`:

```jsx
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Chip, LinearProgress, MenuItem, TextField, Typography } from '@mui/material';
import { useCamps } from '../../api/camps.js';
import { useActiveAlerts } from '../../api/areas.js';
import { useLiveCampUpdates } from '../../api/socket.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';

const STATUS_TONE = { open: 'ok', nearly_full: 'warn', full: 'bad', temporarily_closed: 'neutral', closed: 'neutral' };
const STATUS_LABEL = {
  open: 'Open', nearly_full: 'Nearly Full', full: 'Full',
  temporarily_closed: 'Temporarily Closed', closed: 'Closed',
};

export function LandingPage() {
  useLiveCampUpdates();
  const navigate = useNavigate();
  const { data: camps = [] } = useCamps();
  const { data: alerts = [] } = useActiveAlerts();
  const [search, setSearch] = useState('');
  const [district, setDistrict] = useState('');

  const districts = useMemo(() => [...new Set(camps.map((c) => c.district))], [camps]);

  const visible = camps.filter((c) => {
    if (district && c.district !== district) return false;
    if (search && !`${c.name} ${c.area}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <Box>
      {alerts.length > 0 && (
        <Box
          sx={{
            display: 'flex', alignItems: 'flex-start', gap: 1.75, p: '16px 18px',
            bgcolor: '#FFF0E4', border: '1px solid #FFD9BC', borderLeft: '4px solid #C44E00',
            borderRadius: '12px', mb: 3.75,
          }}
        >
          <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: '#C44E00', mt: 0.75, flex: '0 0 9px' }} />
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 14, color: '#C44E00' }}>
              Active flood alert · {alerts.length} area{alerts.length === 1 ? '' : 's'} under active warning
            </Typography>
            <Typography sx={{ fontSize: 13, color: '#5C5C5C', mt: 0.4 }}>
              {alerts[0].area_name}: {alerts[0].message}
              {alerts.length > 1 ? ` (+${alerts.length - 1} more)` : ''}
            </Typography>
          </Box>
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2.5 }}>
        <Box>
          <Typography variant="h4" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>
            Open relief camps near you
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Live occupancy and volunteer slots, updated as registrations are accepted.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <TextField size="small" placeholder="Search camp or area" value={search} onChange={(e) => setSearch(e.target.value)} />
          <TextField select size="small" label="District" value={district} onChange={(e) => setDistrict(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All districts</MenuItem>
            {districts.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
          </TextField>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 2.25 }}>
        {visible.map((camp) => {
          const occPct = Math.min(100, Math.round((camp.beneficiaries_accepted / camp.beneficiary_capacity) * 100));
          const volPct = Math.min(100, Math.round((camp.volunteers_accepted / camp.volunteer_capacity) * 100));
          const volLeft = camp.volunteer_capacity - camp.volunteers_accepted;
          const isFull = ['full', 'closed', 'temporarily_closed'].includes(camp.status);
          return (
            <Box key={camp.id} sx={{ bgcolor: '#fff', border: '1px solid #F0E2D5', borderRadius: '14px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ p: '18px 18px 14px' }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
                  <Box>
                    <Typography sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, fontSize: 17 }}>{camp.name}</Typography>
                    <Typography sx={{ fontSize: 12.5, color: '#7A7A7A', mt: 0.5 }}>{camp.area} · {camp.district}</Typography>
                  </Box>
                  <StatusBadge tone={STATUS_TONE[camp.status]}>{STATUS_LABEL[camp.status]}</StatusBadge>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1.5 }}>
                  {Object.entries(camp.facilities || {})
                    .filter(([, v]) => v === true)
                    .slice(0, 4)
                    .map(([k]) => (
                      <Chip key={k} label={k.replace(/_/g, ' ')} size="small" sx={{ bgcolor: '#FAF6F2', border: '1px solid #F0E7DE' }} />
                    ))}
                </Box>
              </Box>
              <Box sx={{ p: '14px 18px', bgcolor: '#FFFBF7', borderTop: '1px solid #F5EAE0', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#5C5C5C', mb: 0.75 }}>
                    <span>Beneficiary occupancy</span>
                    <strong>{camp.beneficiaries_accepted} / {camp.beneficiary_capacity}</strong>
                  </Box>
                  <LinearProgress variant="determinate" value={occPct} sx={{ height: 7, borderRadius: 6, bgcolor: '#F2E4D7' }} />
                </Box>
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#5C5C5C', mb: 0.75 }}>
                    <span>Volunteer slots</span>
                    <strong>{volLeft} left of {camp.volunteer_capacity}</strong>
                  </Box>
                  <LinearProgress
                    variant="determinate" value={volPct}
                    sx={{ height: 7, borderRadius: 6, bgcolor: '#F2E4D7', '& .MuiLinearProgress-bar': { bgcolor: '#C44E00' } }}
                  />
                </Box>
              </Box>
              <Box sx={{ p: '14px 18px', borderTop: '1px solid #F5EAE0', mt: 'auto' }}>
                <Button fullWidth variant="contained" disabled={isFull} onClick={() => navigate(`/register/${camp.id}`)}>
                  {isFull ? 'Camp full' : 'Register for camp'}
                </Button>
              </Box>
            </Box>
          );
        })}
      </Box>
      {visible.length === 0 && (
        <Typography color="text.secondary" sx={{ mt: 4 }}>No camps match your search.</Typography>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace client`
Expected: PASS — 4 new tests.

- [ ] **Step 5: Wire the routes**

Modify `client/src/App.jsx`:

```jsx
import { LandingPage } from './features/landing/LandingPage.jsx';
```

Replace the two `Placeholder` routes in the unrestricted `<RequireAuth>`
block with:

```jsx
<Route path="/" element={<LandingPage />} />
<Route path="/donor" element={<LandingPage />} />
<Route path="/register/:campId" element={<Placeholder title="Registration opens in the next update" />} />
```

(`Placeholder` is already defined in `App.jsx` from Plan 1 — this is the
same honest-stub pattern, not a new component. The registration wizard
itself is Plan 3.)

- [ ] **Step 6: Commit**

```bash
git add client/
git commit -m "$(cat <<'EOF'
feat: add the public camps-discovery landing page

Serves both / and /donor per requirements section 6.2, which specifies
the same landing page for Affected Person and Donor — a donor-specific
dashboard belongs to Group F, not built yet.

The "Register for camp" button always navigates somewhere real, even
though the registration wizard is Plan 3's work: requirements section 13's
"must not silently lose entered data" implies a button must not silently
do nothing either, so it opens a real stub route rather than a dead click.

Occupancy and volunteer-slot bars update live via useLiveCampUpdates —
Task 5's camps service broadcasts on every mutation, this page just
listens.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: End-to-end verification against slices 3–4

**Files:**
- Create: `docs/superpowers/plans/2026-08-12-m1-plan2-verification.md`

**Interfaces:**
- Consumes: everything built in Tasks 1–10
- Produces: a written verification record

**"Done when" from spec §10:** slice 3 — "admin records an area; alert
appears"; slice 4 — "camp created; landing page lists it with live
occupancy." This runs the real system against real Atlas, not the
in-memory harness, the same way Plan 1's Task 12 did.

- [ ] **Step 1: Run the whole suite and record the count**

Run: `npm test`
Expected: PASS, zero failures. Record the exact test count.

- [ ] **Step 2: Start the real stack**

```bash
npm run dev
```

- [ ] **Step 3: Walk the manual checks**

Confirm each, recording the result:

1. Sign in as the seeded admin → `/admin/areas` → record an affected area → it appears in the list immediately (no reload).
2. From that area, raise a flood alert (`POST /api/areas/:id/alerts` — no UI button for this in M1, call it directly) → sign in as an affected person → the alert banner appears on `/`.
3. As admin, create a camp with the full field set via `/admin/camps/new` → it appears in `/admin/camps` and on the public landing page (`/` and `/donor`) with `0 / capacity` occupancy and status **Open**.
4. Open the landing page in two browser tabs. In one, `PATCH` the camp's `admin_override` to `temporarily_closed` (via `/admin/camps` once an edit action exists, or `curl` directly). Confirm the **second tab's badge updates without a reload** — proof Socket.IO invalidation actually works end to end, not just in the Task 4/5 unit tests.
5. `GET /api/camps/nearest?latitude=...&longitude=...` returns the created camp, excluding any camp whose `admin_override` makes it unavailable.
6. `POST /api/areas` and `POST /api/camps` as a donor → both **403**, proving server-side enforcement independent of what any UI shows.
7. Query `audit_logs` in Atlas → entries for `area.create`, `alert.create`, `camp.create`, `camp.update`; no secrets in any `before`/`after`.

- [ ] **Step 4: Write the verification record**

Create `docs/superpowers/plans/2026-08-12-m1-plan2-verification.md` with:
date, test count, each of the seven checks with PASS/FAIL and evidence,
and any defect found with its follow-up task.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs: record Plan 2 verification against slices 3-4 acceptance criteria

Milestone work is done when verified against the spec's own "done when"
column, not when the code looks finished. Checks ran against real Atlas,
covering: recording an affected area and seeing its alert on the landing
page, creating a camp with the full section 6.3 field set, live Socket.IO
occupancy updates observed across two browser tabs (not just asserted by
a unit test), the nearest-camp query, and server-side 403 enforcement
independent of the UI.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Plan 2 Self-Review

**Spec coverage.** §6.1 (affected areas) → Task 2. §6.2's landing-page
requirement → Task 10. §6.3 (camp field set, capacity auto-update, status
lifecycle) → Tasks 3, 5, 6. §5.3's capacity compare-and-swap → Task 5,
proven by an actual concurrent-request race test, not just code review.
§7.3's Socket.IO/query-invalidation pattern → Tasks 4, 7, and exercised
live (not just unit-tested) in Task 11 Step 3.4. §18's "computed, never
manually entered" → Task 1's `deriveCampStatus` and Task 3's schema
deliberately excluding the occupancy counters from create/update input.

**Deferred to later plans, by design:** actually reserving beneficiary
slots (`reserveBeneficiarySlots` exists and is tested, but its only caller
until Plan 3 is the test suite itself — intake is what calls it for real).
Camp-detail/edit UI beyond the create form and `admin_override` PATCH.
Resolving flood alerts (`FloodAlert.status` supports `resolved`, no route
sets it yet — flagged as a gap to close whenever an admin alert-management
screen is built, not required by slices 3–4's "done when").

**Type consistency check.** `Camp.toSafeJSON()` returns `assigned_official_id`
as a string or null; `CampsListPage` reads exactly that field. `deriveCampStatus`
takes `{beneficiaries_accepted, beneficiary_capacity, admin_override}` —
every call site (`camps.service.js`'s three call points) passes all three,
sourced from the same document, never a partial object. `emitCampOccupancy`'s
payload shape (`beneficiaries_accepted`, `beneficiary_capacity`,
`volunteers_accepted`, `volunteer_capacity`, `status`) matches what the
landing page and camps list actually read off `camp:occupancy` — although
neither reads the socket payload directly; both just refetch via
`invalidateQueries`, which is the point of the pattern.

**Known simplification to flag:** the admin camps list shows "Assigned" /
"Unassigned" for the camp official rather than the official's name — that
needs a `populate()` or a join the current `toSafeJSON()` doesn't do.
Small, self-contained fix whenever the volunteer/check-in modules (Plan 3)
need the official's identity for real.
