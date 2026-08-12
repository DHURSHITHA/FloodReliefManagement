# Intake (Registration, Aadhaar Crypto, Dedup, Priority, Volunteer FCFS, Check-in) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Milestone 1's Intake module (spec slices 5–7): a family registers at a camp and receives a Beneficiary ID, Aadhaar is encrypted at rest with hard+soft duplicate detection, priority is computed automatically, volunteer slots are granted first-come-first-served, and camp staff can check members in.

**Architecture:** A new `intake` server module owns `beneficiaries`, `registration_members`, and `camp_checkins`, following the existing module-ownership rule — nothing outside `intake/` touches these models directly. The registration submission is one MongoDB transaction: dedup check → member creation (hard-dedup surfaces here via a partial unique index) → beneficiary-capacity reservation (reusing Plan 2's `reserveBeneficiarySlots`) → volunteer FCFS grant (a new `reserveVolunteerSlots` in the camps module, since camps owns `volunteer_capacity`/`volunteers_accepted`) → audit record. Client-side: one registration wizard screen (self + add family members, drafted to `sessionStorage`), and one camp-official check-in screen.

**Tech Stack:** Same as Plans 1–2 — Express 5, Mongoose 9, Zod 4, MongoDB transactions via `MongoMemoryReplSet` in tests, React 19 + MUI + TanStack Query on the client.

## Global Constraints

- Aadhaar is never stored in the clear: `aadhaar_hash` (HMAC-SHA256, server-held pepper), `aadhaar_enc` (AES-256-GCM), `aadhaar_last4` (plaintext, display only) — spec §2.1.
- Hard dedup: partial unique index on `aadhaar_hash` where `is_active_registration: true` — a person cannot hold two active registrations, but may register again once a prior one closes (spec §2.2).
- Soft dedup: fuzzy name+mobile/address match sets `duplicate_warning`, never blocks (spec §2.2).
- Priority (`priority_tags`, `priority_level`) is computed in a Mongoose `pre('validate')` hook — never settable from a request body (spec §5.2, §7).
- Volunteer capacity is granted strictly first-come-first-served, in submission order; members beyond the line remain full beneficiaries with `volunteer_status: 'not_accepted_slots_full'` (spec §5.3).
- `POST /registrations` accepts an `Idempotency-Key` header; a repeated key returns the original response rather than creating a second registration (spec §8).
- The registration wizard must not silently lose entered data on a recoverable validation failure — draft to `sessionStorage`; a 409 duplicate-Aadhaar response identifies the exact colliding member so the wizard can flag just that person (spec §7.2).
- Every mutation is audited via `recordAudit()`; the audit scrubber already strips `aadhaar`/`aadhaar_hash`/`aadhaar_enc` keys (Plan 1's `audit.service.js`), so audit payloads must not defeat that by nesting secrets under other key names.
- `req.validatedQuery`, not `req.query`, for any query-validated route — Express 5 makes `req.query` a getter-only accessor (the bug fixed in Plan 2's `validate.js`).

---

### Task 1: Aadhaar crypto core

**Files:**
- Create: `server/src/core/crypto.js`
- Test: `server/src/core/crypto.test.js`

**Interfaces:**
- Consumes: `env.AADHAAR_HMAC_PEPPER`, `env.AADHAAR_ENC_KEY` (already validated 64-hex-char secrets in `server/src/config/env.js`)
- Produces: `hashAadhaar(aadhaar: string): string`, `encryptAadhaar(aadhaar: string): string`, `decryptAadhaar(enc: string): string`

- [ ] **Step 1: Write the failing test**

Create `server/src/core/crypto.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { hashAadhaar, encryptAadhaar, decryptAadhaar } from './crypto.js';

describe('hashAadhaar', () => {
  it('is deterministic for the same input', () => {
    expect(hashAadhaar('234567890123')).toBe(hashAadhaar('234567890123'));
  });

  it('differs for different inputs', () => {
    expect(hashAadhaar('234567890123')).not.toBe(hashAadhaar('234567890124'));
  });

  it('never contains the plaintext number', () => {
    expect(hashAadhaar('234567890123')).not.toContain('234567890123');
  });
});

describe('encryptAadhaar / decryptAadhaar', () => {
  it('round-trips to the original value', () => {
    const enc = encryptAadhaar('234567890123');
    expect(decryptAadhaar(enc)).toBe('234567890123');
  });

  it('produces a different ciphertext each call (random IV) but still decrypts correctly', () => {
    const a = encryptAadhaar('234567890123');
    const b = encryptAadhaar('234567890123');
    expect(a).not.toBe(b);
    expect(decryptAadhaar(a)).toBe('234567890123');
    expect(decryptAadhaar(b)).toBe('234567890123');
  });

  it('never contains the plaintext number', () => {
    expect(encryptAadhaar('234567890123')).not.toContain('234567890123');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace server -- crypto.test.js`
Expected: FAIL — cannot resolve `./crypto.js`.

- [ ] **Step 3: Implement it**

Create `server/src/core/crypto.js`:

```js
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const pepper = Buffer.from(env.AADHAAR_HMAC_PEPPER, 'hex');
const encKey = Buffer.from(env.AADHAAR_ENC_KEY, 'hex'); // 32 bytes → AES-256

/** Deterministic HMAC — same input always hashes the same, so a unique index
 * on this value works exactly like a unique index on the plaintext would,
 * without ever storing the plaintext (spec section 2.1). */
export function hashAadhaar(aadhaar) {
  return crypto.createHmac('sha256', pepper).update(String(aadhaar)).digest('hex');
}

/** AES-256-GCM, for lawful retrieval only. IV + auth tag + ciphertext are
 * packed together so decryptAadhaar needs nothing but this one string. */
export function encryptAadhaar(aadhaar) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(aadhaar), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptAadhaar(enc) {
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace server -- crypto.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/core/crypto.js server/src/core/crypto.test.js
git commit -m "$(cat <<'EOF'
feat: add Aadhaar HMAC hashing and AES-256-GCM encryption core

Three fields replace the spec's plaintext aadhaar field (section 2.1):
aadhaar_hash (this module's hashAadhaar, deterministic, feeds the dedup
unique index), aadhaar_enc (this module's encrypt/decryptAadhaar, for
lawful retrieval only), aadhaar_last4 (plaintext, display only — added
by the intake models in a later task). The HMAC pepper and AES key come
from environment variables already validated in config/env.js since
Plan 1, never committed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Beneficiary ID generator

**Files:**
- Create: `server/src/core/idGenerator.js`
- Test: `server/src/core/idGenerator.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `nextBeneficiaryCode(session?): Promise<string>` — returns `"BEN-1001"`, `"BEN-1002"`, ... sequentially

**Why atomic counters, not `count()`:** spec section 4.2 deviation #3 — generating `BEN-1025` by counting existing documents races under concurrent submission; two families could receive the same code. An atomic `$inc` with `upsert` is the only race-free method.

- [ ] **Step 1: Write the failing test**

Create `server/src/core/idGenerator.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { nextBeneficiaryCode } from './idGenerator.js';
import { clearDatabase } from '../test/helpers.js';

describe('nextBeneficiaryCode', () => {
  beforeEach(async () => { await clearDatabase(); });

  it('starts at BEN-1001', async () => {
    expect(await nextBeneficiaryCode()).toBe('BEN-1001');
  });

  it('increments on each call', async () => {
    await nextBeneficiaryCode();
    expect(await nextBeneficiaryCode()).toBe('BEN-1002');
  });

  it('never issues the same code twice under concurrent calls', async () => {
    const codes = await Promise.all(Array.from({ length: 10 }, () => nextBeneficiaryCode()));
    expect(new Set(codes).size).toBe(10);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace server -- idGenerator.test.js`
Expected: FAIL — cannot resolve `./idGenerator.js`.

- [ ] **Step 3: Implement it**

Create `server/src/core/idGenerator.js`:

```js
import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema(
  { _id: String, seq: { type: Number, default: 0 } },
  { collection: 'counters' }
);

const Counter = mongoose.model('Counter', counterSchema);

/** Atomic $inc + upsert — the only race-free way to hand out sequential
 * Beneficiary IDs under concurrent registrations (spec section 4.2). */
export async function nextBeneficiaryCode(session) {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'beneficiary_code' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );
  return `BEN-${1000 + counter.seq}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace server -- idGenerator.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/core/idGenerator.js server/src/core/idGenerator.test.js
git commit -m "$(cat <<'EOF'
feat: add atomic Beneficiary ID generator

nextBeneficiaryCode() uses $inc + upsert on a counters collection —
spec section 4.2's deviation #3: generating "BEN-1025" by counting
documents races under concurrent submission, so an atomic increment is
the only race-free method. Proven with a real Promise.all race test.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Idempotency core

**Files:**
- Create: `server/src/core/idempotency.js`
- Test: `server/src/core/idempotency.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `withIdempotency(key: string|undefined, fn: () => Promise<any>): Promise<any>`

**Behaviour:** spec §8 — `POST /registrations` accepts an `Idempotency-Key` header; a repeated key returns the original response rather than re-running `fn`. No key means no idempotency (`fn` always runs).

- [ ] **Step 1: Write the failing test**

Create `server/src/core/idempotency.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withIdempotency } from './idempotency.js';
import { clearDatabase } from '../test/helpers.js';

describe('withIdempotency', () => {
  beforeEach(async () => { await clearDatabase(); });

  it('runs fn when no key is given', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true });
    await withIdempotency(undefined, fn);
    await withIdempotency(undefined, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs fn once and returns the cached result on a repeated key', async () => {
    const fn = vi.fn().mockResolvedValue({ value: 42 });
    const first = await withIdempotency('key-1', fn);
    const second = await withIdempotency('key-1', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ value: 42 });
    expect(second).toEqual({ value: 42 });
  });

  it('treats different keys independently', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true });
    await withIdempotency('key-a', fn);
    await withIdempotency('key-b', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace server -- idempotency.test.js`
Expected: FAIL — cannot resolve `./idempotency.js`.

- [ ] **Step 3: Implement it**

Create `server/src/core/idempotency.js`:

```js
import mongoose from 'mongoose';

const idempotencyRecordSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    response: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: 'idempotency_records' }
);

// 24h TTL — long enough to cover a poor-connection double-tap, short enough
// not to accumulate forever.
idempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

const IdempotencyRecord = mongoose.model('IdempotencyRecord', idempotencyRecordSchema);

/**
 * Run `fn` once per key. A repeated key returns the first call's result
 * without re-running `fn` — spec section 8's "a repeated key returns the
 * original response rather than creating a second registration."
 * `fn`'s return value must be plain, JSON-serializable data (a Mongoose
 * document would serialize its internal metadata too); callers should
 * shape their result with toSafeJSON() before returning it here.
 */
export async function withIdempotency(key, fn) {
  if (!key) return fn();

  const existing = await IdempotencyRecord.findOne({ key });
  if (existing) return existing.response;

  const result = await fn();
  try {
    await IdempotencyRecord.create({ key, response: result });
  } catch (err) {
    // Another request with the same key won the race to write the record
    // first — its result is equally valid, nothing to do.
    if (err?.code !== 11000) throw err;
  }
  return result;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace server -- idempotency.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/core/idempotency.js server/src/core/idempotency.test.js
git commit -m "$(cat <<'EOF'
feat: add idempotency-key core for safe double-submit handling

withIdempotency() runs fn once per key and returns the cached result on
a repeat — spec section 8's requirement that POST /registrations and
POST /distributions must not create a second record when a user
double-taps on a poor connection. 24h TTL on the record collection.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Registration shared schemas

**Files:**
- Create: `shared/src/schemas/registration.schema.js`
- Modify: `shared/src/index.js`
- Test: `shared/src/schemas/registration.schema.test.js`

**Interfaces:**
- Consumes: `objectId` (from `./camp.schema.js`), `isValidAadhaar` (from `../aadhaar.js`)
- Produces: `registrationMemberInputSchema`, `createRegistrationSchema`, `searchRegistrationsQuerySchema` (zod)

The applicant (`members[0]`) must supply `mobile` and `address`; every other member must supply `relation_to_applicant` — enforced with `superRefine` since the requirement differs by array position, which a per-field schema can't express alone.

- [ ] **Step 1: Write the failing test**

Create `shared/src/schemas/registration.schema.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createRegistrationSchema, searchRegistrationsQuerySchema } from './registration.schema.js';

const validAadhaar = '234567890123'; // passes the Verhoeff checksum

const applicant = (over = {}) => ({
  name: 'Meena Devi', age: 34, gender: 'female', aadhaar: validAadhaar,
  mobile: '9876543210', address: '12 River Road, Ward 12', ...over,
});
const familyMember = (over = {}) => ({
  name: 'Raju Devi', age: 8, gender: 'male', aadhaar: '234567890132',
  relation_to_applicant: 'child', ...over,
});

describe('createRegistrationSchema', () => {
  const campId = '507f1f77bcf86cd799439011';

  it('accepts an applicant registering alone', () => {
    const result = createRegistrationSchema.safeParse({ camp_id: campId, members: [applicant()] });
    expect(result.success).toBe(true);
  });

  it('accepts an applicant with family members', () => {
    const result = createRegistrationSchema.safeParse({
      camp_id: campId, members: [applicant(), familyMember()],
    });
    expect(result.success).toBe(true);
  });

  it('requires mobile and address for the applicant', () => {
    const result = createRegistrationSchema.safeParse({
      camp_id: campId, members: [applicant({ mobile: undefined, address: undefined })],
    });
    expect(result.success).toBe(false);
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('members.0.mobile');
    expect(paths).toContain('members.0.address');
  });

  it('requires relation_to_applicant for non-applicant members', () => {
    const result = createRegistrationSchema.safeParse({
      camp_id: campId, members: [applicant(), familyMember({ relation_to_applicant: undefined })],
    });
    expect(result.success).toBe(false);
    expect(result.error.issues.map((i) => i.path.join('.'))).toContain('members.1.relation_to_applicant');
  });

  it('rejects an invalid Aadhaar number', () => {
    const result = createRegistrationSchema.safeParse({
      camp_id: campId, members: [applicant({ aadhaar: '123456789012' })],
    });
    expect(result.success).toBe(false);
  });

  it('requires at least one member', () => {
    const result = createRegistrationSchema.safeParse({ camp_id: campId, members: [] });
    expect(result.success).toBe(false);
  });
});

describe('searchRegistrationsQuerySchema', () => {
  it('requires a non-empty search term', () => {
    expect(searchRegistrationsQuerySchema.safeParse({ search: '' }).success).toBe(false);
    expect(searchRegistrationsQuerySchema.safeParse({ search: 'BEN-1001' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace shared`
Expected: FAIL — cannot resolve `./registration.schema.js`.

- [ ] **Step 3: Implement it**

Create `shared/src/schemas/registration.schema.js`:

```js
import { z } from 'zod';
import { objectId } from './camp.schema.js';
import { isValidAadhaar } from '../aadhaar.js';

const mobileRegex = /^(?:\+91|0)?[6-9]\d{9}$/;

export const registrationMemberInputSchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(120),
  age: z.coerce.number().int().min(0, 'Age must be zero or more.').max(120),
  gender: z.enum(['male', 'female', 'other'], { message: 'Select a valid gender.' }),
  aadhaar: z.string().trim().refine(isValidAadhaar, 'Enter a valid Aadhaar number.'),
  is_pregnant: z.boolean().default(false),
  has_disability: z.boolean().default(false),
  wants_to_volunteer: z.boolean().default(false),
  relation_to_applicant: z.string().trim().min(1).max(60).optional(),
  mobile: z.string().trim().regex(mobileRegex, 'Enter a valid 10-digit mobile number.').optional(),
  address: z.string().trim().min(1).max(300).optional(),
});

export const createRegistrationSchema = z
  .object({
    camp_id: objectId,
    members: z
      .array(registrationMemberInputSchema)
      .min(1, 'At least one person is required.')
      .max(20, 'Register at most 20 people at once.'),
  })
  .superRefine((data, ctx) => {
    data.members.forEach((m, i) => {
      if (i === 0) {
        if (!m.mobile) {
          ctx.addIssue({ code: 'custom', path: ['members', i, 'mobile'], message: 'A mobile number is required for the applicant.' });
        }
        if (!m.address) {
          ctx.addIssue({ code: 'custom', path: ['members', i, 'address'], message: 'An address is required for the applicant.' });
        }
      } else if (!m.relation_to_applicant) {
        ctx.addIssue({ code: 'custom', path: ['members', i, 'relation_to_applicant'], message: 'Relation to the applicant is required.' });
      }
    });
  });

export const searchRegistrationsQuerySchema = z.object({
  search: z.string().trim().min(1, 'Enter a search term.').max(120),
});
```

Modify `shared/src/index.js` — add:

```js
export * from './schemas/registration.schema.js';
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace shared`
Expected: PASS — 7 new tests.

- [ ] **Step 5: Commit**

```bash
git add shared/
git commit -m "$(cat <<'EOF'
feat: add registration request schemas

The applicant (members[0]) must supply mobile and address; every other
member must supply relation_to_applicant — enforced with superRefine
since the requirement differs by array position. Aadhaar validation
reuses shared's isValidAadhaar (12 digits plus Verhoeff checksum) from
Plan 1, so a typo is caught before it ever reaches the dedup index.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Intake models — Beneficiary, RegistrationMember, CampCheckin

**Files:**
- Create: `server/src/modules/intake/beneficiary.model.js`
- Create: `server/src/modules/intake/registrationMember.model.js`
- Create: `server/src/modules/intake/campCheckin.model.js`
- Test: `server/src/modules/intake/registrationMember.model.test.js`

**Interfaces:**
- Consumes: `derivePriority` (from `@frp/shared`, Plan 1)
- Produces: `Beneficiary`, `RegistrationMember`, `CampCheckin` Mongoose models, each with `toSafeJSON()`

`RegistrationMember`'s `pre('validate')` hook computes `priority_tags`/`priority_level` from `age`/`is_pregnant`/`has_disability` on every save — a value passed in the constructor is silently overwritten, proving priority can't be set from a request body (spec §5.2, §7).

- [ ] **Step 1: Write the failing test**

Create `server/src/modules/intake/registrationMember.model.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Beneficiary } from './beneficiary.model.js';
import { RegistrationMember } from './registrationMember.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const validMember = (over = {}) => ({
  beneficiary_id: new mongoose.Types.ObjectId(),
  is_primary: true,
  name: 'Meena Devi', age: 34, gender: 'female',
  mobile: '9876543210', address: '12 River Road',
  aadhaar_hash: 'hash-a', aadhaar_enc: 'enc-a', aadhaar_last4: '0123',
  is_active_registration: true,
  ...over,
});

describe('RegistrationMember', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('computes priority_level high for a senior citizen', async () => {
    const m = await RegistrationMember.create(validMember({ age: 65 }));
    expect(m.priority_tags).toContain('senior_citizen');
    expect(m.priority_level).toBe('high');
  });

  it('computes priority_level normal for a non-vulnerable adult', async () => {
    const m = await RegistrationMember.create(validMember({ age: 34 }));
    expect(m.priority_tags).toEqual([]);
    expect(m.priority_level).toBe('normal');
  });

  it('ignores a priority_level supplied directly, computing it instead', async () => {
    const m = await RegistrationMember.create(validMember({ age: 65, priority_level: 'normal' }));
    expect(m.priority_level).toBe('high');
  });

  it('rejects a second active registration with the same aadhaar_hash', async () => {
    await RegistrationMember.create(validMember({ aadhaar_hash: 'dup-hash' }));
    await expect(RegistrationMember.create(validMember({ aadhaar_hash: 'dup-hash' }))).rejects.toThrow();
  });

  it('allows the same aadhaar_hash again once the earlier registration is inactive', async () => {
    await RegistrationMember.create(validMember({ aadhaar_hash: 'dup-hash', is_active_registration: false }));
    await expect(
      RegistrationMember.create(validMember({ aadhaar_hash: 'dup-hash', is_active_registration: true }))
    ).resolves.toBeTruthy();
  });

  it('toSafeJSON never exposes aadhaar_enc', async () => {
    const m = await RegistrationMember.create(validMember());
    expect(JSON.stringify(m.toSafeJSON())).not.toContain('enc-a');
  });
});

describe('Beneficiary', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('defaults status to applied', async () => {
    const b = await Beneficiary.create({
      beneficiary_code: 'BEN-1001', user_id: new mongoose.Types.ObjectId(), camp_id: new mongoose.Types.ObjectId(),
    });
    expect(b.status).toBe('applied');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace server -- registrationMember.model.test.js`
Expected: FAIL — cannot resolve `./beneficiary.model.js`.

- [ ] **Step 3: Implement the models**

Create `server/src/modules/intake/beneficiary.model.js`:

```js
import mongoose from 'mongoose';

const beneficiarySchema = new mongoose.Schema(
  {
    beneficiary_code: { type: String, required: true, unique: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    status: { type: String, enum: ['applied', 'partially_checked_in', 'active', 'closed'], default: 'applied' },
    duplicate_warning: { type: Boolean, default: false },
    applied_at: { type: Date, default: Date.now },
    closed_at: { type: Date, default: null },
  },
  { timestamps: true, collection: 'beneficiaries' }
);

beneficiarySchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    beneficiary_code: this.beneficiary_code,
    camp_id: this.camp_id.toString(),
    status: this.status,
    duplicate_warning: this.duplicate_warning,
    applied_at: this.applied_at,
  };
};

export const Beneficiary = mongoose.model('Beneficiary', beneficiarySchema);
```

Create `server/src/modules/intake/registrationMember.model.js`:

```js
import mongoose from 'mongoose';
import { derivePriority } from '@frp/shared';

const registrationMemberSchema = new mongoose.Schema(
  {
    beneficiary_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', required: true, index: true },
    is_primary: { type: Boolean, required: true, default: false },
    relation_to_applicant: { type: String, default: null },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    age: { type: Number, required: true, min: 0, max: 120 },
    gender: { type: String, required: true, enum: ['male', 'female', 'other'] },
    mobile: { type: String, default: null, trim: true },
    address: { type: String, default: null, trim: true },
    aadhaar_hash: { type: String, required: true },
    aadhaar_enc: { type: String, required: true, select: false },
    aadhaar_last4: { type: String, required: true },
    is_pregnant: { type: Boolean, default: false },
    has_disability: { type: Boolean, default: false },
    priority_level: { type: String, enum: ['high', 'normal'], default: 'normal' },
    priority_tags: { type: [String], default: [] },
    wants_to_volunteer: { type: Boolean, default: false },
    volunteer_status: {
      type: String,
      enum: ['not_requested', 'accepted', 'not_accepted_slots_full', 'active', 'completed'],
      default: 'not_requested',
    },
    volunteer_task: { type: String, default: null },
    volunteer_shift: { type: String, default: null },
    volunteer_hours: { type: Number, default: 0 },
    checkin_status: { type: String, enum: ['pending', 'checked_in'], default: 'pending' },
    checked_in_at: { type: Date, default: null },
    is_active_registration: { type: Boolean, default: true },
    duplicate_warning: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'registration_members' }
);

// Hard dedup (spec section 2.2): a person cannot hold two ACTIVE
// registrations, but may register again once an earlier one closes.
registrationMemberSchema.index(
  { aadhaar_hash: 1 },
  { unique: true, partialFilterExpression: { is_active_registration: true } }
);

/** Computed here, never settable from a request body (spec sections 5.2, 7). */
registrationMemberSchema.pre('validate', function computePriority(next) {
  const { priority_tags, priority_level } = derivePriority({
    age: this.age, is_pregnant: this.is_pregnant, has_disability: this.has_disability,
  });
  this.priority_tags = priority_tags;
  this.priority_level = priority_level;
  next();
});

registrationMemberSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    beneficiary_id: this.beneficiary_id.toString(),
    is_primary: this.is_primary,
    relation_to_applicant: this.relation_to_applicant,
    name: this.name, age: this.age, gender: this.gender,
    mobile: this.mobile, address: this.address,
    aadhaar_last4: this.aadhaar_last4,
    is_pregnant: this.is_pregnant, has_disability: this.has_disability,
    priority_level: this.priority_level, priority_tags: this.priority_tags,
    wants_to_volunteer: this.wants_to_volunteer, volunteer_status: this.volunteer_status,
    checkin_status: this.checkin_status, checked_in_at: this.checked_in_at,
    duplicate_warning: this.duplicate_warning,
  };
};

export const RegistrationMember = mongoose.model('RegistrationMember', registrationMemberSchema);
```

Create `server/src/modules/intake/campCheckin.model.js`:

```js
import mongoose from 'mongoose';

const campCheckinSchema = new mongoose.Schema(
  {
    beneficiary_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', required: true, index: true },
    member_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RegistrationMember', required: true, index: true },
    camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    verified_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    checked_in_at: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'camp_checkins' }
);

export const CampCheckin = mongoose.model('CampCheckin', campCheckinSchema);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace server -- registrationMember.model.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/intake/
git commit -m "$(cat <<'EOF'
feat: add intake models (Beneficiary, RegistrationMember, CampCheckin)

registration_members holds every individual including the applicant,
distinguished by is_primary — spec section 2.3's resolution: two
collections cannot share one unique index, and section 2.3's own ER
diagram already repeats an identical attribute set on both "entities",
which is really one entity in two containers.

priority_tags/priority_level compute in a pre('validate') hook using
Plan 1's derivePriority(), so they cannot be set from a request body —
proven by a test that passes priority_level explicitly and asserts it
gets overwritten anyway.

The aadhaar_hash partial unique index (is_active_registration: true) is
the hard dedup layer from spec section 2.2: one active registration per
person, but a closed registration doesn't lock someone out of a future
disaster's camp.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Registration service — the intake transaction

**Files:**
- Modify: `server/src/core/errors.js`
- Create: `server/src/modules/intake/intake.service.js`
- Test: `server/src/modules/intake/intake.service.test.js`

**Interfaces:**
- Consumes: `hashAadhaar`, `encryptAadhaar` (Task 1), `nextBeneficiaryCode` (Task 2), `Beneficiary`, `RegistrationMember` (Task 5), `normalizeAadhaar`, `maskAadhaar` (`@frp/shared`, Plan 1), `reserveBeneficiarySlots` (`camps.service.js`, Plan 2), `withTransaction`, `AppError`, `recordAudit`
- Produces: `submitRegistration(input, {actorId,actorRole,ip}): Promise<{beneficiary, members}>`

**Operation order matters:** members are inserted (surfacing the hard-dedup unique-index conflict) *before* `reserveBeneficiarySlots` runs. `reserveBeneficiarySlots` broadcasts `camp:occupancy` on success — if capacity were reserved first and a duplicate-Aadhaar conflict aborted the transaction afterward, connected clients would have already received a false occupancy update. Volunteer FCFS is deliberately **not** wired in here — that's Task 7.

- [ ] **Step 1: Add the two new error codes**

Modify `server/src/core/errors.js` — add to `ERROR_CODES`:

```js
  DUPLICATE_AADHAAR: 'DUPLICATE_AADHAAR',
  CAMP_FULL: 'CAMP_FULL',
```

- [ ] **Step 2: Write the failing test**

Create `server/src/modules/intake/intake.service.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import * as intakeService from './intake.service.js';
import * as campsService from '../camps/camps.service.js';
import { Beneficiary } from './beneficiary.model.js';
import { RegistrationMember } from './registrationMember.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const baseCampInput = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7, flood_severity: 'high',
  beneficiary_capacity: 10, volunteer_capacity: 5, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});
const actor = () => ({ actorId: new mongoose.Types.ObjectId(), actorRole: 'admin', ip: '127.0.0.1' });
const applicant = (over = {}) => ({
  name: 'Meena Devi', age: 34, gender: 'female', aadhaar: '234567890123',
  mobile: '9876543210', address: '12 River Road', is_pregnant: false, has_disability: false,
  wants_to_volunteer: false, ...over,
});

describe('submitRegistration', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates a beneficiary with a BEN- code and marks the applicant primary', async () => {
    const camp = await campsService.createCamp(baseCampInput(), actor());
    const { beneficiary, members } = await intakeService.submitRegistration(
      { camp_id: camp._id, members: [applicant()] },
      actor()
    );
    expect(beneficiary.beneficiary_code).toMatch(/^BEN-\d+$/);
    expect(members).toHaveLength(1);
    expect(members[0].is_primary).toBe(true);
  });

  it('increases the camp beneficiary count by the family size', async () => {
    const camp = await campsService.createCamp(baseCampInput(), actor());
    await intakeService.submitRegistration(
      { camp_id: camp._id, members: [applicant(), applicant({ name: 'Raju', age: 8, aadhaar: '234567890132', mobile: undefined, address: undefined, relation_to_applicant: 'child' })] },
      actor()
    );
    const updated = await campsService.getCampById(camp._id);
    expect(updated.beneficiaries_accepted).toBe(2);
  });

  it('blocks a second active registration with the same Aadhaar and rolls back everything', async () => {
    const camp = await campsService.createCamp(baseCampInput(), actor());
    await intakeService.submitRegistration({ camp_id: camp._id, members: [applicant()] }, actor());

    await expect(
      intakeService.submitRegistration(
        { camp_id: camp._id, members: [applicant({ name: 'Meena Duplicate' })] },
        actor()
      )
    ).rejects.toMatchObject({ code: 'DUPLICATE_AADHAAR' });

    const updated = await campsService.getCampById(camp._id);
    expect(updated.beneficiaries_accepted).toBe(1); // not 2 — the second attempt's capacity reservation never happened
    expect(await Beneficiary.countDocuments()).toBe(1);
  });

  it('refuses registration once the camp is full', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 1 }), actor());
    await intakeService.submitRegistration({ camp_id: camp._id, members: [applicant()] }, actor());

    await expect(
      intakeService.submitRegistration(
        { camp_id: camp._id, members: [applicant({ name: 'Someone Else', aadhaar: '234567890132' })] },
        actor()
      )
    ).rejects.toMatchObject({ code: 'CAMP_FULL' });
  });

  it('sets duplicate_warning when name and mobile fuzzy-match an existing active registration', async () => {
    const camp = await campsService.createCamp(baseCampInput(), actor());
    await intakeService.submitRegistration({ camp_id: camp._id, members: [applicant()] }, actor());

    const { beneficiary } = await intakeService.submitRegistration(
      {
        camp_id: camp._id,
        members: [applicant({ name: 'Meena Devi', aadhaar: '234567890132' })], // same name+mobile, different Aadhaar
      },
      actor()
    );
    expect(beneficiary.duplicate_warning).toBe(true);
  });

  it('never overshoots capacity under two concurrent registrations for the last bed', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 1 }), actor());

    const results = await Promise.allSettled([
      intakeService.submitRegistration({ camp_id: camp._id, members: [applicant({ aadhaar: '234567890123' })] }, actor()),
      intakeService.submitRegistration({ camp_id: camp._id, members: [applicant({ aadhaar: '234567890230', mobile: '9876500000' })] }, actor()),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const updated = await campsService.getCampById(camp._id);
    expect(updated.beneficiaries_accepted).toBe(1);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --workspace server -- intake.service.test.js`
Expected: FAIL — cannot resolve `./intake.service.js`.

- [ ] **Step 4: Implement it**

Create `server/src/modules/intake/intake.service.js`:

```js
import { Beneficiary } from './beneficiary.model.js';
import { RegistrationMember } from './registrationMember.model.js';
import { hashAadhaar, encryptAadhaar } from '../../core/crypto.js';
import { nextBeneficiaryCode } from '../../core/idGenerator.js';
import { normalizeAadhaar, maskAadhaar } from '@frp/shared';
import { withTransaction } from '../../core/transaction.js';
import { AppError } from '../../core/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { reserveBeneficiarySlots } from '../camps/camps.service.js';
import { Camp } from '../camps/camp.model.js';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The registration transaction. Order matters: members are inserted (the
 * hard-dedup unique index surfaces conflicts here) BEFORE capacity is
 * reserved, so a duplicate-Aadhaar abort never leaves a false
 * camp:occupancy broadcast behind — reserveBeneficiarySlots only broadcasts
 * on real success. Volunteer FCFS is not wired in here; see Task 7.
 */
export async function submitRegistration(input, { actorId, actorRole, ip }) {
  const { camp_id, members } = input;

  return withTransaction(async (session) => {
    const camp = await Camp.findById(camp_id).session(session);
    if (!camp) throw AppError.notFound('No camp with that id.');

    // Soft dedup (spec section 2.2): fuzzy name + mobile/address match
    // against any other ACTIVE registration. Never blocks — only flags.
    const applicant = members[0];
    const fuzzyMatch = await RegistrationMember.exists({
      is_active_registration: true,
      name: new RegExp(`^${escapeRegex(applicant.name.trim())}$`, 'i'),
      $or: [{ mobile: applicant.mobile }, { address: applicant.address }],
    }).session(session);
    const duplicate_warning = Boolean(fuzzyMatch);

    const beneficiary_code = await nextBeneficiaryCode(session);
    const [beneficiary] = await Beneficiary.create(
      [{ beneficiary_code, user_id: actorId, camp_id, duplicate_warning }],
      { session }
    );

    const createdMembers = [];
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const normalized = normalizeAadhaar(m.aadhaar);
      try {
        const [doc] = await RegistrationMember.create(
          [
            {
              beneficiary_id: beneficiary._id,
              is_primary: i === 0,
              relation_to_applicant: i === 0 ? null : m.relation_to_applicant,
              name: m.name, age: m.age, gender: m.gender,
              mobile: i === 0 ? m.mobile : null,
              address: i === 0 ? m.address : null,
              aadhaar_hash: hashAadhaar(normalized),
              aadhaar_enc: encryptAadhaar(normalized),
              aadhaar_last4: normalized.slice(-4),
              is_pregnant: m.is_pregnant, has_disability: m.has_disability,
              wants_to_volunteer: m.wants_to_volunteer,
              is_active_registration: true,
              duplicate_warning,
            },
          ],
          { session }
        );
        createdMembers.push(doc);
      } catch (err) {
        if (err?.code === 11000) {
          throw AppError.conflict(
            'DUPLICATE_AADHAAR',
            `${m.name}, ${maskAadhaar(m.aadhaar)} already has an active registration.`,
            [{ path: `members.${i}.aadhaar`, message: 'This person already has an active registration.' }]
          );
        }
        throw err;
      }
    }

    const updatedCamp = await reserveBeneficiarySlots(camp_id, members.length, session);
    if (!updatedCamp) {
      throw AppError.conflict(
        'CAMP_FULL',
        'This camp does not have enough remaining capacity for your family.',
        [{ path: 'camp_id', message: 'Camp is full. Try the nearest open camp instead.' }]
      );
    }

    await recordAudit({
      actor_id: actorId, actor_role: actorRole, action: 'registration.create',
      module: 'intake', record_id: beneficiary._id,
      after: { beneficiary_code, camp_id: String(camp_id), member_count: members.length, duplicate_warning },
      ip, session,
    });

    return { beneficiary, members: createdMembers };
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace server -- intake.service.test.js`
Expected: PASS — 6 tests. The concurrent-registration test occasionally takes longer — both calls genuinely hit MongoDB at once.

- [ ] **Step 6: Commit**

```bash
git add server/src/core/errors.js server/src/modules/intake/intake.service.js server/src/modules/intake/intake.service.test.js
git commit -m "$(cat <<'EOF'
feat: add the registration transaction (dedup, priority, capacity, ID)

submitRegistration() is the intake transaction: soft fuzzy-match sets
duplicate_warning without blocking, members are inserted one at a time
so the hard aadhaar_hash unique index names exactly which member
collided (spec section 5.1's "Meena, XXXX XXXX 4471" requirement),
beneficiary capacity is reserved via Plan 2's reserveBeneficiarySlots
only after members are safely created, and a Beneficiary ID is issued
via the atomic counter from Task 2.

Members are inserted BEFORE capacity is reserved, not after: reserving
capacity broadcasts camp:occupancy on success, and a duplicate-Aadhaar
abort discovered afterward would otherwise leave a false live-occupancy
update on every connected client's screen.

Proven with a real concurrent-registration race test for the last bed,
not just code review.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Volunteer FCFS

**Files:**
- Modify: `server/src/modules/camps/camps.service.js`, `server/src/modules/camps/camps.service.test.js`
- Modify: `server/src/modules/intake/intake.service.js`, `server/src/modules/intake/intake.service.test.js`

**Interfaces:**
- Consumes: `Camp` model (Plan 2)
- Produces: `reserveVolunteerSlots(campId, requestedCount, session?): Promise<number>` — the number actually granted, `0..requestedCount`

**Why one atomic pipeline update, not a hand-rolled retry loop:** `volunteers_accepted = min(volunteer_capacity, volunteers_accepted + requestedCount)` computed inside a single `findOneAndUpdate` aggregation-pipeline update is already race-free at the document level — no other write can interleave with it. Concurrent transactions racing on the *same* camp document get a MongoDB write conflict, which `withTransaction()` (Plan 1) already retries automatically — spec section 5.3's "compare-and-swap guarded... bounded retry on conflict" describes exactly this mechanism, not something to reimplement by hand.

- [ ] **Step 1: Write the failing tests**

Modify `server/src/modules/camps/camps.service.test.js` — add at the end, before the final closing of the file:

```js
describe('reserveVolunteerSlots', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('grants the full amount when enough slots remain', async () => {
    const camp = await campsService.createCamp(baseCampInput({ volunteer_capacity: 5 }), actor());
    const granted = await campsService.reserveVolunteerSlots(camp._id, 3);
    expect(granted).toBe(3);
    const saved = await Camp.findById(camp._id);
    expect(saved.volunteers_accepted).toBe(3);
  });

  it('grants a partial amount when fewer slots remain than requested', async () => {
    const camp = await campsService.createCamp(baseCampInput({ volunteer_capacity: 5 }), actor());
    await campsService.reserveVolunteerSlots(camp._id, 3); // 2 slots left
    const granted = await campsService.reserveVolunteerSlots(camp._id, 3); // wants 3, only 2 remain
    expect(granted).toBe(2);
  });

  it('grants zero once capacity is exhausted', async () => {
    const camp = await campsService.createCamp(baseCampInput({ volunteer_capacity: 2 }), actor());
    await campsService.reserveVolunteerSlots(camp._id, 2);
    expect(await campsService.reserveVolunteerSlots(camp._id, 1)).toBe(0);
  });

  it('never grants more than capacity under two concurrent requests for the last slot', async () => {
    const camp = await campsService.createCamp(baseCampInput({ volunteer_capacity: 5 }), actor());
    await campsService.reserveVolunteerSlots(camp._id, 4); // 1 slot left

    const [a, b] = await Promise.all([
      campsService.reserveVolunteerSlots(camp._id, 1),
      campsService.reserveVolunteerSlots(camp._id, 1),
    ]);
    expect(a + b).toBe(1);

    const saved = await Camp.findById(camp._id);
    expect(saved.volunteers_accepted).toBe(5);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace server -- camps.service.test.js`
Expected: FAIL — `campsService.reserveVolunteerSlots is not a function`.

- [ ] **Step 3: Implement it**

Modify `server/src/modules/camps/camps.service.js` — add after `reserveBeneficiarySlots`:

```js
/**
 * Grant up to `requestedCount` volunteer slots, first-come-first-served.
 * Returns the number actually granted (0..requestedCount) — a partial
 * grant is expected, not an error (spec section 5.3): if three opt in
 * against two remaining slots, exactly two are granted.
 *
 * volunteers_accepted = min(volunteer_capacity, volunteers_accepted + N)
 * computed in one atomic pipeline update — no other write can interleave.
 * Concurrent transactions on the same camp get a MongoDB write conflict,
 * which withTransaction() already retries automatically.
 */
export async function reserveVolunteerSlots(campId, requestedCount, session) {
  if (requestedCount <= 0) return 0;

  const before = await Camp.findById(campId).session(session);
  if (!before) return 0;

  const after = await Camp.findOneAndUpdate(
    { _id: campId },
    [
      {
        $set: {
          volunteers_accepted: {
            $min: ['$volunteer_capacity', { $add: ['$volunteers_accepted', requestedCount] }],
          },
        },
      },
    ],
    { new: true, session }
  );

  const granted = after.volunteers_accepted - before.volunteers_accepted;
  if (granted > 0) {
    recomputeStatus(after);
    await after.save({ session });
    broadcastOccupancy(after);
  }
  return granted;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace server -- camps.service.test.js`
Expected: PASS — 4 new tests, 13 total in that file.

- [ ] **Step 5: Wire it into the registration transaction**

Modify `server/src/modules/intake/intake.service.js` — import `reserveVolunteerSlots` alongside `reserveBeneficiarySlots`, and insert this block right after the `reserveBeneficiarySlots` capacity check (after the `if (!updatedCamp) { ... }` block, before `recordAudit`):

```js
    const optedIn = createdMembers.filter((m) => m.wants_to_volunteer);
    if (optedIn.length > 0) {
      const granted = await reserveVolunteerSlots(camp_id, optedIn.length, session);
      for (let i = 0; i < optedIn.length; i++) {
        optedIn[i].volunteer_status = i < granted ? 'accepted' : 'not_accepted_slots_full';
        await optedIn[i].save({ session });
      }
    }
```

Update the import line:

```js
import { reserveBeneficiarySlots, reserveVolunteerSlots } from '../camps/camps.service.js';
```

Modify `server/src/modules/intake/intake.service.test.js` — add at the end:

```js
describe('volunteer FCFS during registration', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('accepts exactly as many opted-in members as slots remain, in submission order', async () => {
    const camp = await campsService.createCamp(baseCampInput({ volunteer_capacity: 2, beneficiary_capacity: 10 }), actor());
    const { members } = await intakeService.submitRegistration(
      {
        camp_id: camp._id,
        members: [
          applicant({ wants_to_volunteer: true }),
          applicant({ name: 'A', aadhaar: '234567890132', mobile: undefined, address: undefined, relation_to_applicant: 'sibling', wants_to_volunteer: true }),
          applicant({ name: 'B', aadhaar: '234567890230', mobile: undefined, address: undefined, relation_to_applicant: 'sibling', wants_to_volunteer: true }),
        ],
      },
      actor()
    );
    expect(members[0].volunteer_status).toBe('accepted');
    expect(members[1].volunteer_status).toBe('accepted');
    expect(members[2].volunteer_status).toBe('not_accepted_slots_full');
  });

  it('leaves volunteer_status not_requested for members who did not opt in', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 10 }), actor());
    const { members } = await intakeService.submitRegistration(
      { camp_id: camp._id, members: [applicant({ wants_to_volunteer: false })] },
      actor()
    );
    expect(members[0].volunteer_status).toBe('not_requested');
  });
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace server -- intake.service.test.js`
Expected: PASS — 2 new tests, 8 total in that file.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/camps/camps.service.js server/src/modules/camps/camps.service.test.js server/src/modules/intake/intake.service.js server/src/modules/intake/intake.service.test.js
git commit -m "$(cat <<'EOF'
feat: add volunteer FCFS grant, wired into registration

reserveVolunteerSlots computes volunteers_accepted = min(capacity,
accepted + requested) in one atomic pipeline update — race-free at the
document level, with MongoDB's own write-conflict detection plus
withTransaction's existing retry covering the cross-transaction case
spec section 5.3 calls "compare-and-swap guarded... bounded retry",
rather than a hand-rolled retry loop.

Wired into submitRegistration after beneficiary capacity is confirmed:
members who opted in are granted in submission order (applicant first,
then family members as entered) up to whatever's left; anyone past the
line gets not_accepted_slots_full and remains a full beneficiary, per
spec section 5.3.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Registration API routes

**Files:**
- Create: `server/src/modules/intake/intake.controller.js`, `server/src/modules/intake/intake.routes.js`
- Modify: `server/src/app.js`
- Test: `server/src/modules/intake/intake.routes.test.js`

**Interfaces:**
- Consumes: `submitRegistration` (Task 6), `withIdempotency` (Task 3), `authenticate`, `authorize`, `validate`
- Produces: `getMyRegistration(userId)`, `getRegistrationByCode(code, {actorRole,actorCampId})`, `searchRegistrations({search,actorRole,actorCampId})` (added to `intake.service.js`); `POST /api/registrations`, `GET /api/registrations/me`, `GET /api/registrations`, `GET /api/registrations/:code`

**Route ordering:** `/registrations/me` is registered before `/registrations/:code` — same class of bug Plan 2 avoided for `/camps/nearest` vs `/camps/:id`.

- [ ] **Step 1: Add the read-side service functions**

Modify `server/src/modules/intake/intake.service.js` — add at the end:

```js
export async function getMyRegistration(userId) {
  const beneficiary = await Beneficiary.findOne({ user_id: userId }).sort({ createdAt: -1 });
  if (!beneficiary) return null;
  const members = await RegistrationMember.find({ beneficiary_id: beneficiary._id });
  return { beneficiary, members };
}

export async function getRegistrationByCode(code, { actorRole, actorCampId }) {
  const beneficiary = await Beneficiary.findOne({ beneficiary_code: code.toUpperCase() });
  if (!beneficiary) throw AppError.notFound('No registration with that code.');
  if (actorRole === 'camp_official' && String(beneficiary.camp_id) !== String(actorCampId)) {
    throw AppError.forbidden('You may only view registrations at your assigned camp.');
  }
  const members = await RegistrationMember.find({ beneficiary_id: beneficiary._id });
  return { beneficiary, members };
}

export async function searchRegistrations({ search, actorRole, actorCampId }) {
  const campFilter = actorRole === 'camp_official' ? { camp_id: actorCampId } : {};

  const byCode = await Beneficiary.findOne({ beneficiary_code: search.toUpperCase(), ...campFilter });
  if (byCode) {
    const members = await RegistrationMember.find({ beneficiary_id: byCode._id });
    return [{ beneficiary: byCode.toSafeJSON(), members: members.map((m) => m.toSafeJSON()) }];
  }

  const primaryMatches = await RegistrationMember.find({
    is_primary: true,
    $or: [{ name: new RegExp(escapeRegex(search), 'i') }, { mobile: search }],
  }).limit(20);

  const beneficiaryIds = primaryMatches.map((m) => m.beneficiary_id);
  const beneficiaries = await Beneficiary.find({ _id: { $in: beneficiaryIds }, ...campFilter });

  const results = [];
  for (const b of beneficiaries) {
    const members = await RegistrationMember.find({ beneficiary_id: b._id });
    results.push({ beneficiary: b.toSafeJSON(), members: members.map((m) => m.toSafeJSON()) });
  }
  return results;
}
```

- [ ] **Step 2: Write the failing test**

Create `server/src/modules/intake/intake.routes.test.js`:

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
    name: 'Test', mobile: String(9300000000 + Math.floor(Math.random() * 699999999)),
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
const registrationBody = (campId, over = {}) => ({
  camp_id: campId,
  members: [{
    name: 'Meena Devi', age: 34, gender: 'female', aadhaar: '234567890123',
    mobile: '9876543210', address: '12 River Road',
  }],
  ...over,
});

async function createCamp(admin) {
  const res = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
  return res.body.camp.id;
}

describe('POST /api/registrations', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an affected person register', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person = await makeUser('affected_person');

    const res = await request(app).post('/api/registrations').set(bearer(person)).send(registrationBody(campId));
    expect(res.status).toBe(201);
    expect(res.body.beneficiary.beneficiary_code).toMatch(/^BEN-\d+$/);
  });

  it('refuses an admin (only affected persons register themselves)', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const res = await request(app).post('/api/registrations').set(bearer(admin)).send(registrationBody(campId));
    expect(res.status).toBe(403);
  });

  it('returns the same response on a repeated Idempotency-Key without creating a second beneficiary', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person = await makeUser('affected_person');
    const body = registrationBody(campId);

    const first = await request(app).post('/api/registrations').set(bearer(person)).set('Idempotency-Key', 'test-key-1').send(body);
    const second = await request(app).post('/api/registrations').set(bearer(person)).set('Idempotency-Key', 'test-key-1').send(body);

    expect(second.body.beneficiary.beneficiary_code).toBe(first.body.beneficiary.beneficiary_code);
  });

  it('returns 409 with the colliding member on duplicate Aadhaar', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person1 = await makeUser('affected_person');
    const person2 = await makeUser('affected_person');

    await request(app).post('/api/registrations').set(bearer(person1)).send(registrationBody(campId));
    const res = await request(app).post('/api/registrations').set(bearer(person2)).send(registrationBody(campId));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_AADHAAR');
    expect(res.body.error.details[0].path).toBe('members.0.aadhaar');
  });
});

describe('GET /api/registrations/me', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it("returns the caller's own registration", async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person = await makeUser('affected_person');
    await request(app).post('/api/registrations').set(bearer(person)).send(registrationBody(campId));

    const res = await request(app).get('/api/registrations/me').set(bearer(person));
    expect(res.status).toBe(200);
    expect(res.body.registration.beneficiary.beneficiary_code).toMatch(/^BEN-\d+$/);
  });

  it('returns null when the caller has not registered', async () => {
    const person = await makeUser('affected_person');
    const res = await request(app).get('/api/registrations/me').set(bearer(person));
    expect(res.body.registration).toBeNull();
  });
});

describe('GET /api/registrations (search) and GET /api/registrations/:code', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an official find a registration by code', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person = await makeUser('affected_person');
    const created = await request(app).post('/api/registrations').set(bearer(person)).send(registrationBody(campId));
    const code = created.body.beneficiary.beneficiary_code;

    const res = await request(app).get(`/api/registrations/${code}`).set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.registration.beneficiary.beneficiary_code).toBe(code);
  });

  it('lets an official search by name', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person = await makeUser('affected_person');
    await request(app).post('/api/registrations').set(bearer(person)).send(registrationBody(campId));

    const res = await request(app).get('/api/registrations?search=Meena').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.registrations).toHaveLength(1);
  });

  it('refuses a donor', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).get('/api/registrations?search=Meena').set(bearer(donor));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --workspace server -- intake.routes.test.js`
Expected: FAIL — 404s across the board, no `/api/registrations` routes mounted.

- [ ] **Step 4: Implement the controller**

Create `server/src/modules/intake/intake.controller.js`:

```js
import * as intakeService from './intake.service.js';
import { withIdempotency } from '../../core/idempotency.js';

export async function createRegistrationHandler(req, res) {
  const idKey = req.headers['idempotency-key'];
  const responseBody = await withIdempotency(idKey, async () => {
    const result = await intakeService.submitRegistration(req.body, {
      actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
    });
    return {
      beneficiary: result.beneficiary.toSafeJSON(),
      members: result.members.map((m) => m.toSafeJSON()),
    };
  });
  res.status(201).json(responseBody);
}

export async function getMyRegistrationHandler(req, res) {
  const registration = await intakeService.getMyRegistration(req.user.id);
  if (!registration) return res.json({ registration: null });
  res.json({
    registration: {
      beneficiary: registration.beneficiary.toSafeJSON(),
      members: registration.members.map((m) => m.toSafeJSON()),
    },
  });
}

export async function getRegistrationByCodeHandler(req, res) {
  const registration = await intakeService.getRegistrationByCode(req.params.code, {
    actorRole: req.user.role, actorCampId: req.user.camp_id,
  });
  res.json({
    registration: {
      beneficiary: registration.beneficiary.toSafeJSON(),
      members: registration.members.map((m) => m.toSafeJSON()),
    },
  });
}

export async function searchRegistrationsHandler(req, res) {
  const results = await intakeService.searchRegistrations({
    search: req.validatedQuery.search, actorRole: req.user.role, actorCampId: req.user.camp_id,
  });
  res.json({ registrations: results });
}
```

- [ ] **Step 5: Implement the routes**

Create `server/src/modules/intake/intake.routes.js`:

```js
import { Router } from 'express';
import { createRegistrationSchema, searchRegistrationsQuerySchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  createRegistrationHandler, getMyRegistrationHandler, getRegistrationByCodeHandler, searchRegistrationsHandler,
} from './intake.controller.js';

export const intakeRouter = Router();

intakeRouter.post('/registrations', authenticate, authorize('affected_person'), validate(createRegistrationSchema), createRegistrationHandler);
// /me before /:code — Express matches in declaration order and :code would
// otherwise swallow the literal "me" segment.
intakeRouter.get('/registrations/me', authenticate, authorize('affected_person'), getMyRegistrationHandler);
intakeRouter.get('/registrations', authenticate, authorize('admin', 'camp_official'), validate(searchRegistrationsQuerySchema, 'query'), searchRegistrationsHandler);
intakeRouter.get('/registrations/:code', authenticate, authorize('admin', 'camp_official'), getRegistrationByCodeHandler);
```

Modify `server/src/app.js` — add the import and mount alongside `campsRouter`:

```js
import { intakeRouter } from './modules/intake/intake.routes.js';
// ...
app.use('/api', intakeRouter);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace server -- intake.routes.test.js`
Expected: PASS — 9 tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/intake/ server/src/app.js
git commit -m "$(cat <<'EOF'
feat: add registration API routes

POST /registrations is affected_person-only (they register themselves)
and honors an Idempotency-Key header via Task 3's withIdempotency, so a
double-tap on a poor connection returns the original response instead
of creating a second family's registration.

GET /registrations/me is the caller's own lookup; GET /registrations/:code
and the ?search= list are admin/camp_official only, camp-scoped for
officials the same way Plan 1's requireOwnCamp scopes other routes —
here inline in the service, since the camp id isn't available until
after the beneficiary is looked up, unlike routes where it's already in
the URL or body. /registrations/me is registered before /registrations/:code
for the same route-ordering reason Plan 2 fixed for /camps/nearest.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Check-in

**Files:**
- Modify: `server/src/modules/intake/intake.service.js`, `server/src/modules/intake/intake.controller.js`, `server/src/modules/intake/intake.routes.js`
- Test: `server/src/modules/intake/checkin.test.js`

**Interfaces:**
- Consumes: `Beneficiary`, `RegistrationMember`, `CampCheckin` (Task 5)
- Produces: `checkInMember(beneficiaryId, memberId, {actorId,actorRole,actorCampId,ip}): Promise<{member,beneficiary}>`; `POST /api/registrations/:beneficiaryId/members/:memberId/checkin`

Not wrapped in `withTransaction`: check-in touches no capacity counter or financial invariant, only a status flag and an append-only event log, so the added transaction overhead isn't justified here — this is a deliberate simplification, not an oversight (recorded in the plan's self-review).

- [ ] **Step 1: Write the failing test**

Create `server/src/modules/intake/checkin.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { CampCheckin } from './campCheckin.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9400000000 + Math.floor(Math.random() * 599999999)),
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
const registrationBody = (campId) => ({
  camp_id: campId,
  members: [
    { name: 'Meena Devi', age: 34, gender: 'female', aadhaar: '234567890123', mobile: '9876543210', address: '12 River Road' },
    { name: 'Raju', age: 8, gender: 'male', aadhaar: '234567890132', relation_to_applicant: 'child' },
  ],
});

async function registerFamily() {
  const admin = await makeUser('admin');
  const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
  const campId = campRes.body.camp.id;
  const person = await makeUser('affected_person');
  const regRes = await request(app).post('/api/registrations').set(bearer(person)).send(registrationBody(campId));
  return { campId, beneficiary: regRes.body.beneficiary, members: regRes.body.members, admin };
}

describe('POST /api/registrations/:beneficiaryId/members/:memberId/checkin', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('checks in one member, leaving the beneficiary partially_checked_in', async () => {
    const { beneficiary, members, admin } = await registerFamily();
    const res = await request(app)
      .post(`/api/registrations/${beneficiary.id}/members/${members[0].id}/checkin`)
      .set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.member.checkin_status).toBe('checked_in');

    const record = await request(app).get(`/api/registrations/${beneficiary.beneficiary_code}`).set(bearer(admin));
    expect(record.body.registration.beneficiary.status).toBe('partially_checked_in');
  });

  it('marks the beneficiary active once every member is checked in', async () => {
    const { beneficiary, members, admin } = await registerFamily();
    for (const m of members) {
      await request(app).post(`/api/registrations/${beneficiary.id}/members/${m.id}/checkin`).set(bearer(admin));
    }
    const record = await request(app).get(`/api/registrations/${beneficiary.beneficiary_code}`).set(bearer(admin));
    expect(record.body.registration.beneficiary.status).toBe('active');
  });

  it('writes an event to the camp_checkins log', async () => {
    const { beneficiary, members, admin } = await registerFamily();
    await request(app).post(`/api/registrations/${beneficiary.id}/members/${members[0].id}/checkin`).set(bearer(admin));
    const events = await CampCheckin.find({ beneficiary_id: beneficiary.id });
    expect(events).toHaveLength(1);
  });

  it('refuses a camp official assigned to a different camp', async () => {
    const { beneficiary, members } = await registerFamily();
    const otherCamp = await makeUser('admin');
    const otherCampRes = await request(app).post('/api/camps').set(bearer(otherCamp)).send(campBody({ name: 'Other Camp' }));
    const official = await makeUser('camp_official', { assigned_camp_id: otherCampRes.body.camp.id, status: 'active' });

    const res = await request(app)
      .post(`/api/registrations/${beneficiary.id}/members/${members[0].id}/checkin`)
      .set(bearer(official));
    expect(res.status).toBe(403);
  });

  it('refuses a second check-in of the same member', async () => {
    const { beneficiary, members, admin } = await registerFamily();
    await request(app).post(`/api/registrations/${beneficiary.id}/members/${members[0].id}/checkin`).set(bearer(admin));
    const res = await request(app).post(`/api/registrations/${beneficiary.id}/members/${members[0].id}/checkin`).set(bearer(admin));
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace server -- checkin.test.js`
Expected: FAIL — 404, no checkin route mounted.

- [ ] **Step 3: Implement it**

Modify `server/src/modules/intake/intake.service.js` — add the import and function:

```js
import { CampCheckin } from './campCheckin.model.js';
```

```js
export async function checkInMember(beneficiaryId, memberId, { actorId, actorRole, actorCampId, ip }) {
  const beneficiary = await Beneficiary.findById(beneficiaryId);
  if (!beneficiary) throw AppError.notFound('No registration with that id.');
  if (actorRole === 'camp_official' && String(beneficiary.camp_id) !== String(actorCampId)) {
    throw AppError.forbidden('You may only check in members at your assigned camp.');
  }

  const member = await RegistrationMember.findOne({ _id: memberId, beneficiary_id: beneficiaryId });
  if (!member) throw AppError.notFound('No member with that id on this registration.');
  if (member.checkin_status === 'checked_in') {
    throw AppError.conflict('ALREADY_CHECKED_IN', 'This member is already checked in.');
  }

  member.checkin_status = 'checked_in';
  member.checked_in_at = new Date();
  await member.save();

  await CampCheckin.create({
    beneficiary_id: beneficiary._id, member_id: member._id, camp_id: beneficiary.camp_id, verified_by: actorId,
  });

  const allMembers = await RegistrationMember.find({ beneficiary_id: beneficiary._id });
  const checkedInCount = allMembers.filter((m) => m.checkin_status === 'checked_in').length;
  beneficiary.status = checkedInCount === allMembers.length ? 'active' : 'partially_checked_in';
  await beneficiary.save();

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'member.checkin',
    module: 'intake', record_id: member._id,
    after: { beneficiary_code: beneficiary.beneficiary_code, member_name: member.name }, ip,
  });

  return { member, beneficiary };
}
```

Modify `server/src/modules/intake/intake.controller.js` — add:

```js
export async function checkInMemberHandler(req, res) {
  const { member } = await intakeService.checkInMember(req.params.beneficiaryId, req.params.memberId, {
    actorId: req.user.id, actorRole: req.user.role, actorCampId: req.user.camp_id, ip: req.ip,
  });
  res.json({ member: member.toSafeJSON() });
}
```

Modify `server/src/modules/intake/intake.routes.js` — add the import and route:

```js
import { /* ...existing, */ checkInMemberHandler } from './intake.controller.js';
```

```js
intakeRouter.post('/registrations/:beneficiaryId/members/:memberId/checkin', authenticate, authorize('admin', 'camp_official'), checkInMemberHandler);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace server -- checkin.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/intake/
git commit -m "$(cat <<'EOF'
feat: add per-member check-in with an event log and official search

checkInMember() writes an append-only camp_checkins event (who verified
whom and when — spec section 4.2 deviation #2) alongside a denormalised
checkin_status on the member itself, so distribution-screen reads stay
fast without joining the event log. Beneficiary.status flips to
partially_checked_in or active as members check in.

A camp official is scoped to their own assigned camp inline in the
service, not via the existing requireOwnCamp middleware — that
middleware needs the camp id synchronously from the URL or body, but
here it's only known after looking up the beneficiary.

Not wrapped in a transaction: no capacity counter or financial
invariant is at stake, only a status flag and an append-only log, so
the added overhead isn't justified — a deliberate simplification.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Client registration wizard

**Files:**
- Create: `client/src/api/registration.js`
- Create: `client/src/features/intake/RegistrationWizard.jsx`
- Test: `client/src/features/intake/RegistrationWizard.test.jsx`

**Interfaces:**
- Consumes: `POST /api/registrations` (Task 8), `createRegistrationSchema` (`@frp/shared`, Task 4), `toFormErrors` (`api/client.js`, Plan 1)
- Produces: `useSubmitRegistration()`, `<RegistrationWizard>`

Draft state persists to `sessionStorage` on every change, keyed by camp id, so a page reload or a validation failure never loses what's been typed (spec §7.2). A 409 duplicate-Aadhaar response's `details[0].path` (`members.0.aadhaar`) maps directly onto that member's Aadhaar field.

- [ ] **Step 1: Write the failing test**

Create `client/src/features/intake/RegistrationWizard.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegistrationWizard } from './RegistrationWizard.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, post: vi.fn() } };
});

function renderPage(campId = '507f1f77bcf86cd799439011') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/register/${campId}`]}>
        <Routes><Route path="/register/:campId" element={<RegistrationWizard />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); });

async function fillApplicant() {
  await userEvent.type(screen.getByLabelText(/full name/i), 'Meena Devi');
  await userEvent.type(screen.getByLabelText(/age/i), '34');
  await userEvent.click(screen.getByLabelText(/gender/i));
  await userEvent.click(await screen.findByRole('option', { name: /female/i }));
  await userEvent.type(screen.getByLabelText(/aadhaar number/i), '234567890123');
  await userEvent.type(screen.getByLabelText(/mobile number/i), '9876543210');
  await userEvent.type(screen.getByLabelText(/address/i), '12 River Road');
}

describe('RegistrationWizard', () => {
  it('submits an applicant registering alone', async () => {
    api.post.mockResolvedValue({ data: { beneficiary: { id: '1', beneficiary_code: 'BEN-1001' }, members: [] } });
    renderPage();
    await fillApplicant();
    await userEvent.click(screen.getByRole('button', { name: /submit registration/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/registrations',
        expect.objectContaining({ camp_id: '507f1f77bcf86cd799439011' }),
        expect.anything()
      )
    );
    expect(await screen.findByText(/BEN-1001/)).toBeInTheDocument();
  });

  it('adds a family member and requires their relation to the applicant', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /add family member/i }));
    await userEvent.click(screen.getByRole('button', { name: /submit registration/i }));
    expect(await screen.findByText(/relation to the applicant is required/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('flags the exact colliding member on a 409 duplicate response, keeping other fields intact', async () => {
    api.post.mockRejectedValue({
      response: {
        data: {
          error: {
            code: 'DUPLICATE_AADHAAR', message: 'Please correct the highlighted fields.',
            details: [{ path: 'members.0.aadhaar', message: 'This person already has an active registration.' }],
          },
        },
      },
    });
    renderPage();
    await fillApplicant();
    await userEvent.click(screen.getByRole('button', { name: /submit registration/i }));

    expect(await screen.findByText(/already has an active registration/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Meena Devi'); // not lost
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client -- RegistrationWizard.test.jsx`
Expected: FAIL — cannot resolve `./RegistrationWizard.jsx`.

- [ ] **Step 3: Implement the API hooks**

Create `client/src/api/registration.js`:

```js
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useMyRegistration() {
  return useQuery({
    queryKey: ['registrations', 'me'],
    queryFn: async () => (await api.get('/registrations/me')).data.registration,
  });
}

export function useSubmitRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ payload, idempotencyKey }) =>
      (await api.post('/registrations', payload, { headers: { 'Idempotency-Key': idempotencyKey } })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registrations'] }),
  });
}

export function useSearchRegistrations(search) {
  return useQuery({
    queryKey: ['registrations', 'search', search],
    queryFn: async () => (await api.get('/registrations', { params: { search } })).data.registrations,
    enabled: Boolean(search),
  });
}

export function useCheckInMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ beneficiaryId, memberId }) =>
      (await api.post(`/registrations/${beneficiaryId}/members/${memberId}/checkin`)).data.member,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registrations'] }),
  });
}
```

- [ ] **Step 4: Implement the wizard**

Create `client/src/features/intake/RegistrationWizard.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, FormControlLabel, MenuItem, TextField, Typography,
} from '@mui/material';
import { createRegistrationSchema } from '@frp/shared';
import { useSubmitRegistration } from '../../api/registration.js';
import { toFormErrors } from '../../api/client.js';

const emptyApplicant = () => ({
  name: '', age: '', gender: '', aadhaar: '', mobile: '', address: '',
  is_pregnant: false, has_disability: false, wants_to_volunteer: false,
});
const emptyMember = () => ({
  name: '', age: '', gender: '', aadhaar: '', relation_to_applicant: '',
  is_pregnant: false, has_disability: false, wants_to_volunteer: false,
});

export function RegistrationWizard() {
  const { campId } = useParams();
  const navigate = useNavigate();
  const submit = useSubmitRegistration();
  const draftKey = `frp-registration-draft-${campId}`;
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const [members, setMembers] = useState(() => {
    const saved = sessionStorage.getItem(draftKey);
    return saved ? JSON.parse(saved) : [emptyApplicant()];
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    sessionStorage.setItem(draftKey, JSON.stringify(members));
  }, [members, draftKey]);

  const changeMember = (i, field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setMembers((prev) => prev.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)));
  };
  const addMember = () => setMembers((prev) => [...prev, emptyMember()]);
  const removeMember = (i) => setMembers((prev) => prev.filter((_, idx) => idx !== i));

  async function onSubmit(e) {
    e.preventDefault();
    setFormError(null);
    const parsed = createRegistrationSchema.safeParse({ camp_id: campId, members });
    if (!parsed.success) {
      const errors = {};
      for (const issue of parsed.error.issues) errors[issue.path.join('.')] = issue.message;
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    try {
      const result = await submit.mutateAsync({ payload: parsed.data, idempotencyKey });
      sessionStorage.removeItem(draftKey);
      setSuccess(result.beneficiary);
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setFormError(message);
      setFieldErrors(fields);
    }
  }

  if (success) {
    return (
      <Card sx={{ maxWidth: 480 }}>
        <CardContent>
          <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 1 }}>
            Registration complete
          </Typography>
          <Typography sx={{ mb: 2 }}>
            Your family's Beneficiary ID is <strong>{success.beneficiary_code}</strong>. Keep this code — camp
            staff will ask for it at check-in.
          </Typography>
          <Button variant="contained" onClick={() => navigate('/')}>Back to camps</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Box component="form" onSubmit={onSubmit} noValidate sx={{ maxWidth: 720 }}>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>
        Register for this camp
      </Typography>
      {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

      {members.map((m, i) => (
        <Card key={i} sx={{ mb: 2 }}>
          <CardContent>
            <Typography sx={{ fontWeight: 600, mb: 2 }}>
              {i === 0 ? 'Applicant (you)' : `Family member ${i + 1}`}
            </Typography>
            <TextField label="Full name" value={m.name} onChange={changeMember(i, 'name')}
              error={Boolean(fieldErrors[`members.${i}.name`])} helperText={fieldErrors[`members.${i}.name`]} />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField label="Age" value={m.age} onChange={changeMember(i, 'age')}
                error={Boolean(fieldErrors[`members.${i}.age`])} helperText={fieldErrors[`members.${i}.age`]} />
              <TextField select label="Gender" value={m.gender} onChange={changeMember(i, 'gender')}
                error={Boolean(fieldErrors[`members.${i}.gender`])} helperText={fieldErrors[`members.${i}.gender`]}>
                <MenuItem value="male">Male</MenuItem>
                <MenuItem value="female">Female</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </TextField>
            </Box>
            <TextField label="Aadhaar number" value={m.aadhaar} onChange={changeMember(i, 'aadhaar')}
              error={Boolean(fieldErrors[`members.${i}.aadhaar`])} helperText={fieldErrors[`members.${i}.aadhaar`]} />
            {i === 0 ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                <TextField label="Mobile number" value={m.mobile} onChange={changeMember(i, 'mobile')}
                  error={Boolean(fieldErrors[`members.${i}.mobile`])} helperText={fieldErrors[`members.${i}.mobile`]} />
                <TextField label="Address" value={m.address} onChange={changeMember(i, 'address')}
                  error={Boolean(fieldErrors[`members.${i}.address`])} helperText={fieldErrors[`members.${i}.address`]} />
              </Box>
            ) : (
              <TextField label="Relation to applicant" value={m.relation_to_applicant} onChange={changeMember(i, 'relation_to_applicant')}
                error={Boolean(fieldErrors[`members.${i}.relation_to_applicant`])} helperText={fieldErrors[`members.${i}.relation_to_applicant`]} />
            )}
            <FormControlLabel control={<Checkbox checked={m.is_pregnant} onChange={changeMember(i, 'is_pregnant')} />} label="Pregnant" />
            <FormControlLabel control={<Checkbox checked={m.has_disability} onChange={changeMember(i, 'has_disability')} />} label="Has a disability" />
            <FormControlLabel control={<Checkbox checked={m.wants_to_volunteer} onChange={changeMember(i, 'wants_to_volunteer')} />} label="Wants to volunteer" />
            {i > 0 && (
              <Box sx={{ mt: 1 }}>
                <Button size="small" color="error" onClick={() => removeMember(i)}>Remove this person</Button>
              </Box>
            )}
          </CardContent>
        </Card>
      ))}

      <Button onClick={addMember} sx={{ mb: 2 }}>+ Add family member</Button>
      <Box>
        <Button type="submit" variant="contained" size="large" disabled={submit.isPending}>
          {submit.isPending ? 'Submitting…' : 'Submit registration'}
        </Button>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace client -- RegistrationWizard.test.jsx`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/api/registration.js client/src/features/intake/
git commit -m "$(cat <<'EOF'
feat: add the registration wizard (self + add family members)

Draft state persists to sessionStorage on every change, keyed by camp
id, so a reload or a validation failure never loses what's been typed —
requirements section 13's "must not silently lose entered data",
extended by spec section 7.2 to the wizard specifically. A 409
duplicate-Aadhaar response's details[0].path (members.N.aadhaar) maps
directly onto that member's field, so only the colliding person gets
flagged; everyone else's entries stay exactly as typed.

An Idempotency-Key is generated once per wizard mount and reused across
retries of the same submission, so a double-tap on a poor connection
can't create two registrations for the same family.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Client check-in screen

**Files:**
- Create: `client/src/features/official/CheckInPage.jsx`
- Test: `client/src/features/official/CheckInPage.test.jsx`

**Interfaces:**
- Consumes: `useSearchRegistrations`, `useCheckInMember` (Task 10's `api/registration.js`), `StatusBadge` (Plan 2)
- Produces: `<CheckInPage>`

- [ ] **Step 1: Write the failing test**

Create `client/src/features/official/CheckInPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CheckInPage } from './CheckInPage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CheckInPage /></QueryClientProvider>);
}

describe('CheckInPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('searches and lists matching members with a check-in button', async () => {
    api.get.mockResolvedValue({
      data: {
        registrations: [{
          beneficiary: { id: 'b1', beneficiary_code: 'BEN-1001', status: 'applied' },
          members: [
            { id: 'm1', name: 'Meena Devi', checkin_status: 'pending' },
            { id: 'm2', name: 'Raju', checkin_status: 'pending' },
          ],
        }],
      },
    });
    renderPage();
    await userEvent.type(screen.getByLabelText(/search by code, name, or mobile/i), 'Meena');
    expect(await screen.findByText('BEN-1001')).toBeInTheDocument();
    expect(screen.getByText('Meena Devi')).toBeInTheDocument();
    expect(screen.getByText('Raju')).toBeInTheDocument();
  });

  it('checks in a member on click', async () => {
    api.get.mockResolvedValue({
      data: {
        registrations: [{
          beneficiary: { id: 'b1', beneficiary_code: 'BEN-1001', status: 'applied' },
          members: [{ id: 'm1', name: 'Meena Devi', checkin_status: 'pending' }],
        }],
      },
    });
    api.post.mockResolvedValue({ data: { member: { id: 'm1', checkin_status: 'checked_in' } } });
    renderPage();
    await userEvent.type(screen.getByLabelText(/search by code, name, or mobile/i), 'Meena');
    await screen.findByText('Meena Devi');

    await userEvent.click(screen.getByRole('button', { name: /check in/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/registrations/b1/members/m1/checkin'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client -- CheckInPage.test.jsx`
Expected: FAIL — cannot resolve `./CheckInPage.jsx`.

- [ ] **Step 3: Implement it**

Create `client/src/features/official/CheckInPage.jsx`:

```jsx
import { useState } from 'react';
import { Box, Button, Card, CardContent, TextField, Typography } from '@mui/material';
import { useSearchRegistrations, useCheckInMember } from '../../api/registration.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';

export function CheckInPage() {
  const [search, setSearch] = useState('');
  const { data: registrations = [] } = useSearchRegistrations(search);
  const checkIn = useCheckInMember();

  return (
    <Box>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>
        Find a registration
      </Typography>
      <TextField
        label="Search by code, name, or mobile"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 3, minWidth: 320 }}
      />

      {registrations.map(({ beneficiary, members }) => (
        <Card key={beneficiary.id} sx={{ mb: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <Typography sx={{ fontWeight: 600 }}>{beneficiary.beneficiary_code}</Typography>
              <StatusBadge tone={beneficiary.status === 'active' ? 'ok' : 'warn'}>{beneficiary.status}</StatusBadge>
            </Box>
            {members.map((m) => (
              <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1, borderTop: '1px solid #F0E7DE' }}>
                <Typography>{m.name}</Typography>
                {m.checkin_status === 'checked_in' ? (
                  <StatusBadge tone="ok">Checked in</StatusBadge>
                ) : (
                  <Button
                    size="small" variant="outlined"
                    onClick={() => checkIn.mutate({ beneficiaryId: beneficiary.id, memberId: m.id })}
                    disabled={checkIn.isPending}
                  >
                    Check in
                  </Button>
                )}
              </Box>
            ))}
          </CardContent>
        </Card>
      ))}
      {search && registrations.length === 0 && (
        <Typography color="text.secondary">No registration matches "{search}".</Typography>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace client -- CheckInPage.test.jsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/features/official/
git commit -m "$(cat <<'EOF'
feat: add the camp-official check-in screen

Search by code, name, or mobile (backed by Task 8's GET /registrations,
which already checks the code first and falls back to a fuzzy name/mobile
match on the applicant) lists every member with a per-person check-in
button, so an official can verify two of four family members without
the other two blocking anything.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Wire routes and verify against slices 5–7

**Files:**
- Modify: `client/src/App.jsx`
- Create: `docs/superpowers/plans/2026-08-12-m1-plan3-verification.md`

**Interfaces:**
- Consumes: everything from Tasks 1–11
- Produces: real `/register/:campId` and `/official/checkin` routes; a written verification record

**"Done when" from spec §10:** slice 5 — "family registers and receives BEN-1025; duplicate blocked; race test passes"; slice 6 — "3 opt in against 2 slots → exactly 2 accepted, in order"; slice 7 — "official finds by code/mobile/name and verifies 2 of 4 members." This runs the real system against real Atlas, the same way Plans 1 and 2's final tasks did.

- [ ] **Step 1: Wire the routes**

Modify `client/src/App.jsx`:

```jsx
import { RegistrationWizard } from './features/intake/RegistrationWizard.jsx';
import { CheckInPage } from './features/official/CheckInPage.jsx';
```

Replace the `/register/:campId` placeholder route:

```jsx
<Route path="/register/:campId" element={<RegistrationWizard />} />
```

(This route sits inside the existing unrestricted `<RequireAuth>` block from Plan 2 — any authenticated role can reach it, but `POST /registrations` itself is server-side restricted to `affected_person`, so nothing new to add there.)

Add a check-in route inside the existing `camp_official`/`admin` block, alongside `/official`:

```jsx
<Route path="/official/checkin" element={<CheckInPage />} />
```

- [ ] **Step 2: Run the whole suite and record the count**

Run: `npm test`
Expected: PASS, zero failures. Record the count.

- [ ] **Step 3: Start the real stack and walk the manual checks**

```bash
npm run dev
```

Confirm each, recording the result:

1. Sign in as `9822222222` (the affected-person test account) → navigate to `/register/<a real camp id>` → register a family of two, one opted into volunteering → response includes a `BEN-` code.
2. Query `registration_members` in Atlas for that family → `priority_tags`/`priority_level` are populated correctly for anyone matching the rules, and unpopulated for anyone who doesn't.
3. Attempt a second registration reusing one of the same family's Aadhaar numbers → `409 DUPLICATE_AADHAAR`, naming that member.
4. `POST /api/registrations` twice with the same `Idempotency-Key` (`curl`, since the browser wizard doesn't expose retry) → both responses carry the same `beneficiary_code`; only one document exists in `beneficiaries`.
5. Create a camp with `volunteer_capacity: 2`; register three people in one family, all three opted in → exactly two `accepted`, one `not_accepted_slots_full`, in submission order.
6. Sign in as `9833333333` (the approved camp-official test account) → `/official/checkin` → search the family's Beneficiary ID → check in 2 of 4 members → beneficiary status is `partially_checked_in`.
7. `POST /api/registrations` as the admin account → `403` (only `affected_person` may submit).
8. Query `audit_logs` for `registration.create` and `member.checkin` entries → no `aadhaar`/`aadhaar_hash`/`aadhaar_enc` present in any `before`/`after`.

- [ ] **Step 4: Write the verification record**

Create `docs/superpowers/plans/2026-08-12-m1-plan3-verification.md` with: date, test count, each of the eight checks with PASS/FAIL and evidence, and any defect found with its follow-up.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.jsx docs/
git commit -m "$(cat <<'EOF'
feat: wire registration and check-in routes; verify against slices 5-7

/register/:campId now renders the real wizard instead of Plan 2's
placeholder; /official/checkin is new. Verified against the real server
and live Atlas cluster, not just the in-memory suite: a family
registering and receiving a BEN- code, priority tags computed
correctly, duplicate Aadhaar blocked and naming the exact member,
Idempotency-Key preventing a double-tap double-registration, volunteer
FCFS granting exactly as many slots as remain, an official finding a
family by Beneficiary ID and partially checking them in, donor/admin
role enforcement on the write route, and an audit-log read confirming
no Aadhaar data leaks into before/after snapshots.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage.** §2.1 (Aadhaar crypto) → Task 1. §2.2/§5.1 (hard + soft dedup) → Task 6. §2.3 (registration_members holds the applicant) → Task 5. §4.2 deviations #2 (camp_checkins event log + denormalised status), #3 (counters) → Tasks 9, 2. §5.2 (priority, pre-validate hook) → Task 5. §5.3 (beneficiary capacity reuse + volunteer FCFS) → Tasks 6, 7. §6 API surface (`POST /registrations`, `GET /registrations/me|:code|?search=`, checkin route) → Task 8, 9. §7.2 (wizard data preservation, 409 member-flagging) → Task 10. §8 (idempotency) → Tasks 3, 8. §9 (race tests for capacity/volunteer contention) → Tasks 6, 7. §10 slices 5–7's "done when" → Task 12.

**Deferred, by design:** a public "status lookup by code" screen (spec §7.1 lists it separately from the Beneficiary ID success state) — not required by slices 5–7's "done when," and the affected person can already see their own status via `GET /registrations/me`; a dedicated lookup screen is easy to add later without touching what Plan 3 builds. Decrypting Aadhaar for display anywhere (`aadhaar_enc` exists and round-trips correctly per Task 1's tests, but nothing in M1 calls `decryptAadhaar` outside tests — no feature needs lawful retrieval yet). Resource/inventory/distribution (spec slices 8–9) is Plan 4.

**Type consistency check.** `reserveVolunteerSlots(campId, requestedCount, session)` returns a plain number everywhere it's called (Task 7's tests, Task 6's wiring) — never an object, never `null` for "zero granted" (zero is a valid, non-error return). `checkInMember`'s `actorCampId` parameter name matches `req.user.camp_id` exactly as `authenticate` (Plan 1) produces it. `RegistrationMember.toSafeJSON()`'s field names (`checkin_status`, `volunteer_status`, `priority_tags`) match what `CheckInPage.jsx` and the verification doc's manual checks read.

**Known simplification to flag:** `withIdempotency`'s check-then-act isn't itself atomic — two genuinely concurrent requests with the same brand-new key could both see "no record" and both call `fn()`, though the `IdempotencyRecord`'s unique index guarantees only one write persists. This covers the realistic "double-tap on a poor connection" scenario (sequential, not simultaneous) that spec §8 describes; true network-level concurrent duplicates would need a distributed lock, out of scope here.
