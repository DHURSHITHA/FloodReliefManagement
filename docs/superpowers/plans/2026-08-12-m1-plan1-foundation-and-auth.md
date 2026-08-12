# Flood Relief Portal — Plan 1: Foundation & Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, the shared domain package, and a production-grade authentication system so that any of the four roles can sign up, log in, and be authorized server-side.

**Architecture:** npm-workspaces monorepo with three packages — `shared/` (pure domain logic and zod schemas imported by both sides), `server/` (Express 5 + Mongoose, modular by feature), and `client/` (React + Vite + MUI). Authentication uses a short-lived JWT access token plus a rotating refresh token held in an httpOnly cookie and tracked server-side so it can be revoked. Every module owns its collections and exposes a service; other modules never touch another module's model directly.

**Tech Stack:** Node 24, Express 5, Mongoose 8, MongoDB Atlas, zod, jsonwebtoken, bcryptjs, React 19, Vite, MUI, TanStack Query, Vitest, Supertest, mongodb-memory-server.

**Spec:** `docs/superpowers/specs/2026-08-12-flood-relief-portal-m1-design.md`
**Covers:** Milestone 1, slices 1–2 (Group A: Foundation).

## Global Constraints

- **ESM everywhere.** Every `package.json` sets `"type": "module"`. No `require()`.
- **TDD, always.** Write the failing test, watch it fail, write minimal code, watch it pass, commit. Never write implementation before its test.
- **Never log or return a password, password hash, refresh token, JWT secret, HMAC pepper, or encryption key.** Not in errors, not in debug output.
- **Passwords hashed with bcrypt at cost 12** (spec §6). We use `bcryptjs` — same algorithm, pure JavaScript, no native build step on Windows.
- **Access token lifetime 15 minutes. Refresh token lifetime 7 days**, httpOnly + sameSite=strict + secure-in-production cookie (spec §6).
- **Every protected route carries `authorize(...roles)`.** Frontend guards are never the only check (requirements §12).
- **Uniform error envelope** on every error response: `{ "error": { "code", "message", "details": [] } }` (spec §8).
- **Roles are exactly:** `admin`, `camp_official`, `affected_person`, `donor`. No volunteer role — volunteering is a per-person attribute captured at camp registration (requirements §18).
- **No secrets in git.** Everything sensitive comes from `.env`, which `.gitignore` already excludes. `.env.example` holds placeholder values only.
- **Commit after every task**, with the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

```
FloodReliefCamp/
├─ package.json                        root workspace manifest
├─ .env.example                        documented placeholder secrets
├─ shared/
│  ├─ package.json
│  └─ src/
│     ├─ index.js                      barrel export
│     ├─ aadhaar.js                    Verhoeff checksum + isValidAadhaar
│     ├─ aadhaar.test.js
│     ├─ priority.js                   derivePriority
│     ├─ priority.test.js
│     └─ schemas/
│        ├─ auth.schema.js             signup / login zod schemas
│        └─ auth.schema.test.js
├─ server/
│  ├─ package.json
│  ├─ vitest.config.js
│  └─ src/
│     ├─ app.js                        express app factory (no listen)
│     ├─ server.js                     entrypoint: connect + listen
│     ├─ config/
│     │  ├─ env.js                     zod-validated environment
│     │  └─ db.js                      mongoose connection
│     ├─ core/
│     │  ├─ errors.js                  AppError + error codes
│     │  ├─ logger.js                  pino logger with redaction
│     │  └─ transaction.js             withTransaction helper
│     ├─ middleware/
│     │  ├─ errorHandler.js
│     │  ├─ validate.js                zod request validation
│     │  ├─ authenticate.js
│     │  └─ authorize.js
│     ├─ modules/
│     │  ├─ audit/
│     │  │  ├─ audit.model.js
│     │  │  ├─ audit.service.js        recordAudit()
│     │  │  └─ audit.test.js
│     │  └─ auth/
│     │     ├─ user.model.js
│     │     ├─ refreshToken.model.js
│     │     ├─ auth.service.js
│     │     ├─ auth.controller.js
│     │     ├─ auth.routes.js
│     │     ├─ auth.signup.test.js
│     │     ├─ auth.login.test.js
│     │     ├─ auth.refresh.test.js
│     │     └─ auth.approval.test.js
│     ├─ scripts/
│     │  └─ seed.js                    bootstrap admin
│     └─ test/
│        ├─ setup.js                   in-memory replica set
│        └─ helpers.js                 makeUser / authHeaders
└─ client/
   └─ src/
      ├─ main.jsx, App.jsx, theme.js
      ├─ api/client.js                 axios + refresh interceptor
      ├─ api/auth.js                   TanStack Query hooks
      ├─ routes/RequireAuth.jsx
      ├─ layouts/RoleLayout.jsx
      └─ features/auth/{LoginPage,SignupPage}.jsx
```

---

### Task 1: Monorepo scaffold and the Aadhaar validator

**Files:**
- Create: `package.json`, `.env.example`
- Create: `shared/package.json`, `shared/src/index.js`, `shared/src/aadhaar.js`
- Test: `shared/src/aadhaar.test.js`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `verhoeffCheckDigit(digits: string): number` — check digit for a digit string *without* its check digit
  - `verhoeffValidate(numStr: string): boolean` — true when the full string's checksum is valid
  - `isValidAadhaar(value: string): boolean` — full Aadhaar validation
  - `maskAadhaar(value: string): string` — `"XXXX XXXX 1234"`

**Why Verhoeff:** requirements §13 says Aadhaar must follow "the standard 12-digit format". The actual UIDAI standard includes a Verhoeff check digit. Validating it catches typos at the form, before a mistyped number poisons the deduplication index and hands one family's rations to a stranger.

- [ ] **Step 1: Create the root workspace manifest**

Create `package.json`:

```json
{
  "name": "flood-relief-portal",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "client"],
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "dev": "concurrently -n server,client -c blue,green \"npm:dev:server\" \"npm:dev:client\"",
    "dev:server": "npm run dev --workspace server",
    "dev:client": "npm run dev --workspace client"
  }
}
```

`concurrently` is used instead of `&` because `&` does not background commands in PowerShell on Windows.

- [ ] **Step 2: Create the shared package manifest**

Create `shared/package.json`:

```json
{
  "name": "@frp/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.js",
  "exports": { ".": "./src/index.js", "./schemas/*": "./src/schemas/*" },
  "scripts": { "test": "vitest run", "test:watch": "vitest" }
}
```

- [ ] **Step 3: Install tooling**

Run from the repo root:

```bash
npm install -D concurrently
npm install -D vitest --workspace shared
npm install zod --workspace shared
```

Let npm resolve current versions rather than pinning by hand.

- [ ] **Step 4: Write the failing test**

Create `shared/src/aadhaar.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { verhoeffCheckDigit, isValidAadhaar, maskAadhaar } from './aadhaar.js';

describe('isValidAadhaar', () => {
  // Property: for any 11-digit prefix exactly one check digit is valid.
  // This proves the checksum without relying on a hardcoded magic number.
  const prefix = '23456789012';

  it('accepts a number whose check digit is correct', () => {
    const cd = verhoeffCheckDigit(prefix);
    expect(isValidAadhaar(prefix + cd)).toBe(true);
  });

  it('rejects every other check digit for the same prefix', () => {
    const cd = verhoeffCheckDigit(prefix);
    for (let d = 0; d <= 9; d++) {
      if (d === cd) continue;
      expect(isValidAadhaar(prefix + d)).toBe(false);
    }
  });

  it('detects any single-digit typo', () => {
    const valid = prefix + verhoeffCheckDigit(prefix);
    for (let pos = 1; pos < 12; pos++) {
      for (let d = 0; d <= 9; d++) {
        if (Number(valid[pos]) === d) continue;
        const typo = valid.slice(0, pos) + d + valid.slice(pos + 1);
        expect(isValidAadhaar(typo)).toBe(false);
      }
    }
  });

  it('rejects wrong lengths and non-digits', () => {
    expect(isValidAadhaar('12345')).toBe(false);
    expect(isValidAadhaar('2345678901234')).toBe(false);
    expect(isValidAadhaar('23456789O12X')).toBe(false);
    expect(isValidAadhaar('')).toBe(false);
    expect(isValidAadhaar(null)).toBe(false);
    expect(isValidAadhaar(234567890124)).toBe(false);
  });

  it('rejects numbers starting with 0 or 1, which UIDAI never issues', () => {
    const zero = '0' + prefix.slice(1);
    const one = '1' + prefix.slice(1);
    expect(isValidAadhaar(zero + verhoeffCheckDigit(zero))).toBe(false);
    expect(isValidAadhaar(one + verhoeffCheckDigit(one))).toBe(false);
  });

  it('tolerates spaces and hyphens in user input', () => {
    const valid = prefix + verhoeffCheckDigit(prefix);
    const spaced = `${valid.slice(0, 4)} ${valid.slice(4, 8)} ${valid.slice(8)}`;
    expect(isValidAadhaar(spaced)).toBe(true);
    expect(isValidAadhaar(spaced.replaceAll(' ', '-'))).toBe(true);
  });
});

describe('maskAadhaar', () => {
  it('reveals only the last four digits', () => {
    expect(maskAadhaar('234567890124')).toBe('XXXX XXXX 0124');
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test --workspace shared`
Expected: FAIL — cannot resolve `./aadhaar.js`.

- [ ] **Step 6: Implement the validator**

Create `shared/src/aadhaar.js`:

```js
// Verhoeff checksum — the algorithm UIDAI uses for the 12th digit of an Aadhaar.
// D is the Dihedral group D5 multiplication table, P the permutation table,
// INV the multiplicative inverse table. These are fixed constants of the algorithm.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** Check digit for a digit string that does NOT yet include one. */
export function verhoeffCheckDigit(digits) {
  let c = 0;
  const reversed = String(digits).split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = D[c][P[(i + 1) % 8][Number(reversed[i])]];
  }
  return INV[c];
}

/** True when a full digit string (check digit included) has a valid checksum. */
export function verhoeffValidate(numStr) {
  let c = 0;
  const reversed = String(numStr).split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = D[c][P[i % 8][Number(reversed[i])]];
  }
  return c === 0;
}

/** Strip the formatting users naturally type. */
export function normalizeAadhaar(value) {
  return typeof value === 'string' ? value.replace(/[\s-]/g, '') : '';
}

/** Full Aadhaar validation: 12 digits, never starting 0 or 1, valid Verhoeff checksum. */
export function isValidAadhaar(value) {
  const s = normalizeAadhaar(value);
  if (!/^[2-9]\d{11}$/.test(s)) return false;
  return verhoeffValidate(s);
}

/** Display form. Only the last four digits may ever be shown. */
export function maskAadhaar(value) {
  const s = normalizeAadhaar(value);
  return `XXXX XXXX ${s.slice(-4)}`;
}
```

- [ ] **Step 7: Create the barrel export**

Create `shared/src/index.js`:

```js
export * from './aadhaar.js';
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test --workspace shared`
Expected: PASS — 8 tests.

If the first two tests fail together, the `P` table index is wrong: `verhoeffCheckDigit` uses `(i + 1) % 8` and `verhoeffValidate` uses `i % 8`. That asymmetry is correct, not a typo.

- [ ] **Step 9: Create the environment template**

Create `.env.example`:

```bash
NODE_ENV=development
PORT=4000

# MongoDB Atlas connection string for a DEV database.
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster.mongodb.net/flood_relief_dev?retryWrites=true&w=majority

# Generate each with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_ACCESS_SECRET=replace_me_with_64_hex_chars
JWT_REFRESH_SECRET=replace_me_with_64_hex_chars
AADHAAR_HMAC_PEPPER=replace_me_with_64_hex_chars
AADHAAR_ENC_KEY=replace_me_with_exactly_64_hex_chars

CLIENT_ORIGIN=http://localhost:5173

# Consumed once by scripts/seed.js to create the first admin.
BOOTSTRAP_ADMIN_NAME=Relief Administrator
BOOTSTRAP_ADMIN_EMAIL=admin@example.org
BOOTSTRAP_ADMIN_PASSWORD=change_this_immediately
```

- [ ] **Step 10: Commit**

```bash
git add package.json .env.example shared/
git commit -m "$(cat <<'EOF'
feat: scaffold monorepo and add Verhoeff Aadhaar validator

Aadhaar's 12th digit is a Verhoeff check digit. Validating it catches
single-digit typos at the form, before a mistyped number can poison the
deduplication index and misroute another family's rations.

Tested by property rather than magic constants: for any 11-digit prefix
exactly one check digit is accepted, and every single-digit typo in a
valid number is rejected.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Priority derivation in `shared/`

**Files:**
- Create: `shared/src/priority.js`
- Modify: `shared/src/index.js`
- Test: `shared/src/priority.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `derivePriority({ age, is_pregnant, has_disability }): { priority_tags: string[], priority_level: 'high'|'normal' }`

**Why here:** requirements §7 says priority is "never manually tagged". Keeping it a pure function in `shared/` means the browser previews the same classification the server will compute, and neither can drift from the other.

- [ ] **Step 1: Write the failing test**

Create `shared/src/priority.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { derivePriority } from './priority.js';

const person = (over = {}) => ({ age: 30, is_pregnant: false, has_disability: false, ...over });

describe('derivePriority', () => {
  it('classifies an ordinary adult as normal with no tags', () => {
    expect(derivePriority(person())).toEqual({ priority_tags: [], priority_level: 'normal' });
  });

  it('classifies age 60 and above as senior_citizen', () => {
    expect(derivePriority(person({ age: 60 })).priority_tags).toEqual(['senior_citizen']);
    expect(derivePriority(person({ age: 85 })).priority_level).toBe('high');
    expect(derivePriority(person({ age: 59 })).priority_tags).toEqual([]);
  });

  it('classifies age 12 and below as child', () => {
    expect(derivePriority(person({ age: 12 })).priority_tags).toEqual(['child']);
    expect(derivePriority(person({ age: 0 })).priority_level).toBe('high');
    expect(derivePriority(person({ age: 13 })).priority_tags).toEqual([]);
  });

  it('classifies pregnancy and disability', () => {
    expect(derivePriority(person({ is_pregnant: true })).priority_tags).toEqual(['pregnant']);
    expect(derivePriority(person({ has_disability: true })).priority_tags).toEqual(['disability']);
  });

  it('accumulates every applicable tag', () => {
    const r = derivePriority(person({ age: 70, has_disability: true }));
    expect(r.priority_tags).toEqual(['senior_citizen', 'disability']);
    expect(r.priority_level).toBe('high');
  });

  it('returns tags in a stable order regardless of input order', () => {
    const a = derivePriority({ has_disability: true, is_pregnant: true, age: 8 });
    expect(a.priority_tags).toEqual(['child', 'pregnant', 'disability']);
  });

  it('treats a missing or invalid age as normal rather than throwing', () => {
    expect(derivePriority({ age: undefined }).priority_level).toBe('normal');
    expect(derivePriority({}).priority_level).toBe('normal');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace shared`
Expected: FAIL — cannot resolve `./priority.js`.

- [ ] **Step 3: Implement it**

Create `shared/src/priority.js`:

```js
/**
 * Vulnerability classification, per requirements §6.5.
 * Tags are an array, not a single enum, because §6.16 requires children,
 * senior citizens, pregnant women and persons with disability to be counted
 * separately on the dashboard — one person can be several of those at once.
 * Tag order is fixed so stored values are comparable across records.
 */
export function derivePriority({ age, is_pregnant = false, has_disability = false } = {}) {
  const priority_tags = [];
  const numericAge = Number(age);
  const hasAge = Number.isFinite(numericAge);

  if (hasAge && numericAge <= 12) priority_tags.push('child');
  if (hasAge && numericAge >= 60) priority_tags.push('senior_citizen');
  if (is_pregnant === true) priority_tags.push('pregnant');
  if (has_disability === true) priority_tags.push('disability');

  // Fixed display order, independent of the order checks ran in.
  const ORDER = ['senior_citizen', 'child', 'pregnant', 'disability'];
  priority_tags.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  return { priority_tags, priority_level: priority_tags.length > 0 ? 'high' : 'normal' };
}
```

- [ ] **Step 4: Export it**

Modify `shared/src/index.js`:

```js
export * from './aadhaar.js';
export * from './priority.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test --workspace shared`
Expected: PASS — 15 tests total across both files.

The "stable order" test expects `['child', 'pregnant', 'disability']` for an 8-year-old: `child` sorts before `pregnant` and `disability` under `ORDER`.

- [ ] **Step 6: Commit**

```bash
git add shared/
git commit -m "$(cat <<'EOF'
feat: add priority derivation to shared package

Priority is derived, never assigned — requirements section 7 states it is
never manually tagged. Tags are an array because section 6.16 needs
children, seniors, pregnant women and disabled persons counted separately,
and one person can belong to several categories at once.

Living in shared/ means the browser previews exactly what the server will
compute, so the two cannot drift.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Server scaffold, validated environment, error envelope, health endpoint

**Files:**
- Create: `server/package.json`, `server/vitest.config.js`
- Create: `server/src/config/env.js`, `server/src/core/errors.js`, `server/src/core/logger.js`
- Create: `server/src/middleware/errorHandler.js`, `server/src/app.js`
- Test: `server/src/app.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `env` — frozen, validated config object
  - `class AppError extends Error { status, code, message, details }`
  - `ERROR_CODES` — frozen map of code constants
  - `errorHandler(err, req, res, next)` — Express error middleware
  - `createApp(): express.Application` — app factory with no `listen()`, so tests can mount it

**Why an app factory:** Supertest needs an app object without a bound port. Separating `app.js` from `server.js` is what makes every route testable without starting a real server.

- [ ] **Step 1: Create the server package and install dependencies**

Create `server/package.json`:

```json
{
  "name": "@frp/server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "src/server.js",
  "scripts": {
    "dev": "node --watch --env-file=../.env src/server.js",
    "start": "node --env-file=../.env src/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "seed": "node --env-file=../.env src/scripts/seed.js"
  }
}
```

Then from the repo root:

```bash
npm install express@^5 mongoose cookie-parser cors helmet express-rate-limit jsonwebtoken bcryptjs pino pino-http zod --workspace server
npm install -D vitest supertest mongodb-memory-server --workspace server
npm install @frp/shared@* --workspace server
```

`bcryptjs` rather than `bcrypt`: identical algorithm and cost factor, pure JavaScript, no native compilation — which matters on Windows without build tools.

- [ ] **Step 2: Write the failing test**

Create `server/src/app.test.js`:

```js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

describe('app', () => {
  const app = createApp();

  it('reports health without touching the database', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns the uniform error envelope for an unknown route', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String), details: [] },
    });
  });

  it('never leaks a stack trace to the client', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js:\d+/);
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers).toHaveProperty('x-content-type-options', 'nosniff');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — cannot resolve `./app.js`.

- [ ] **Step 4: Implement the validated environment**

Create `server/src/config/env.js`:

```js
import { z } from 'zod';

const hex64 = z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_ACCESS_SECRET: hex64,
  JWT_REFRESH_SECRET: hex64,
  AADHAAR_HMAC_PEPPER: hex64,
  AADHAAR_ENC_KEY: hex64,
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  BOOTSTRAP_ADMIN_NAME: z.string().optional(),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
});

// Tests run without a .env file; supply throwaway values so importing this
// module never explodes under vitest.
const testDefaults =
  process.env.NODE_ENV === 'test'
    ? {
        MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
        JWT_ACCESS_SECRET: 'a'.repeat(64),
        JWT_REFRESH_SECRET: 'b'.repeat(64),
        AADHAAR_HMAC_PEPPER: 'c'.repeat(64),
        AADHAAR_ENC_KEY: 'd'.repeat(64),
      }
    : {};

const parsed = schema.safeParse({ ...testDefaults, ...process.env });

if (!parsed.success) {
  // Print WHICH variable is wrong, never its value.
  const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  console.error(`Invalid environment configuration:\n${problems.join('\n')}`);
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
```

Failing fast at boot beats discovering a missing JWT secret when the first user tries to log in.

- [ ] **Step 5: Implement errors and the logger**

Create `server/src/core/errors.js`:

```js
export const ERROR_CODES = Object.freeze({
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ACCOUNT_PENDING_APPROVAL: 'ACCOUNT_PENDING_APPROVAL',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
});

export class AppError extends Error {
  /**
   * @param {number} status  HTTP status
   * @param {string} code    a value from ERROR_CODES
   * @param {string} message safe for display to an end user
   * @param {Array<{path:string,message:string}>} details field-level errors
   */
  constructor(status, code, message, details = []) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expected = true; // distinguishes deliberate errors from crashes
  }

  static badRequest(message, details = []) {
    return new AppError(400, ERROR_CODES.VALIDATION_FAILED, message, details);
  }
  static unauthenticated(message = 'Authentication required.') {
    return new AppError(401, ERROR_CODES.UNAUTHENTICATED, message);
  }
  static forbidden(message = 'You do not have permission to perform this action.') {
    return new AppError(403, ERROR_CODES.FORBIDDEN, message);
  }
  static notFound(message = 'Not found.') {
    return new AppError(404, ERROR_CODES.NOT_FOUND, message);
  }
  static conflict(code, message, details = []) {
    return new AppError(409, code, message, details);
  }
}
```

Create `server/src/core/logger.js`:

```js
import pino from 'pino';
import { env, isProd, isTest } from '../config/env.js';

export const logger = pino({
  level: isTest ? 'silent' : isProd ? 'info' : 'debug',
  // Belt and braces: even if a secret reaches a log call, it is redacted.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.password_hash',
      '*.refresh_token',
      '*.aadhaar',
      '*.aadhaar_enc',
      '*.aadhaar_hash',
    ],
    censor: '[REDACTED]',
  },
  transport: isProd || isTest ? undefined : { target: 'pino-pretty' },
});

export const loggerEnv = env.NODE_ENV;
```

Install the dev-only pretty printer: `npm install -D pino-pretty --workspace server`

- [ ] **Step 6: Implement the error handler**

Create `server/src/middleware/errorHandler.js`:

```js
import { AppError, ERROR_CODES } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { isProd } from '../config/env.js';

export function notFoundHandler(req, res, next) {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} does not exist.`));
}

// Express identifies error middleware by arity, so `next` must stay declared.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err }, 'expected server error');
    return res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, details: err.details } });
  }

  // Mongoose duplicate key — surfaced as a conflict, never as a 500.
  if (err?.code === 11000) {
    return res.status(409).json({
      error: {
        code: ERROR_CODES.CONFLICT,
        message: 'That record already exists.',
        details: Object.keys(err.keyPattern ?? {}).map((path) => ({
          path,
          message: 'already in use',
        })),
      },
    });
  }

  logger.error({ err }, 'unhandled error');
  return res.status(500).json({
    error: {
      code: ERROR_CODES.INTERNAL,
      // Never expose internals in production.
      message: isProd ? 'An unexpected error occurred.' : String(err?.message ?? err),
      details: [],
    },
  });
}
```

- [ ] **Step 7: Implement the app factory**

Create `server/src/app.js`:

```js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', env: env.NODE_ENV });
  });

  // Feature routers mount here in later tasks.

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
```

Express 5 forwards rejected promises from async handlers to the error middleware automatically, so no `asyncHandler` wrapper is needed.

- [ ] **Step 8: Configure vitest**

Create `server/vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./src/test/setup.js'],
    // One shared process so the in-memory replica set starts once, not per file.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
```

Create a placeholder `server/src/test/setup.js` so this config resolves; Task 4 fills it in:

```js
process.env.NODE_ENV = 'test';
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test --workspace server`
Expected: PASS — 4 tests.

- [ ] **Step 10: Commit**

```bash
git add server/
git commit -m "$(cat <<'EOF'
feat: add server scaffold, validated env, error envelope, health route

Environment is validated by zod at boot and the process exits listing which
variables are wrong — never their values. Failing at startup beats
discovering a missing JWT secret when the first user tries to log in.

Errors always leave through one envelope, { error: { code, message,
details } }, with stack traces and internal messages suppressed in
production. Mongoose duplicate-key errors surface as 409 conflicts rather
than 500s.

app.js is a factory with no listen() so supertest can mount it directly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Test harness on an in-memory replica set, proving transactions work

**Files:**
- Modify: `server/src/test/setup.js`
- Create: `server/src/test/helpers.js`, `server/src/config/db.js`, `server/src/core/transaction.js`
- Test: `server/src/core/transaction.test.js`

**Interfaces:**
- Consumes: `env` (Task 3)
- Produces:
  - `connectDb(uri?): Promise<void>`, `disconnectDb(): Promise<void>`
  - `withTransaction(fn: (session) => Promise<T>): Promise<T>`
  - `clearDatabase(): Promise<void>` (test helper)

**Why this task exists on its own:** every invariant in the spec — capacity guards, stock deduction, the intake transaction — depends on multi-document transactions, and those need a replica set. A plain `mongodb-memory-server` instance is standalone and silently cannot do them. Proving this now, with a test, means Plans 3 and 4 are not built on a false assumption.

- [ ] **Step 1: Write the failing test**

Create `server/src/core/transaction.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { withTransaction } from './transaction.js';
import { clearDatabase } from '../test/helpers.js';

const Widget = mongoose.model(
  'Widget',
  new mongoose.Schema({ name: String, count: Number }, { collection: 'widgets' })
);

describe('withTransaction', () => {
  beforeEach(async () => { await clearDatabase(); });

  it('commits every write when the callback resolves', async () => {
    await withTransaction(async (session) => {
      await Widget.create([{ name: 'a', count: 1 }], { session });
      await Widget.create([{ name: 'b', count: 2 }], { session });
    });
    expect(await Widget.countDocuments()).toBe(2);
  });

  it('rolls back every write when the callback throws', async () => {
    await expect(
      withTransaction(async (session) => {
        await Widget.create([{ name: 'a', count: 1 }], { session });
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // Proves transactions are genuinely active. On a standalone mongod the
    // first write would have persisted and this would be 1.
    expect(await Widget.countDocuments()).toBe(0);
  });

  it('returns the callback result', async () => {
    const result = await withTransaction(async () => 'done');
    expect(result).toBe('done');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — cannot resolve `./transaction.js`.

- [ ] **Step 3: Implement the database connection**

Create `server/src/config/db.js`:

```js
import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../core/logger.js';

mongoose.set('strictQuery', true);
// Build indexes automatically in development; in production they are created
// deliberately at deploy time so a hot path never blocks on index construction.
mongoose.set('autoIndex', env.NODE_ENV !== 'production');

export async function connectDb(uri = env.MONGODB_URI) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  logger.info('mongodb connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
```

- [ ] **Step 4: Implement the transaction helper**

Create `server/src/core/transaction.js`:

```js
import mongoose from 'mongoose';

/**
 * Run `fn` inside a MongoDB transaction and return its result.
 *
 * session.withTransaction retries automatically on TransientTransactionError
 * and UnknownTransactionCommitResult, which is what spec §8 requires. It also
 * aborts on any thrown error, so partial writes cannot survive.
 *
 * Requires a replica set. Atlas is one; a standalone mongod is not.
 */
export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
```

- [ ] **Step 5: Implement the test harness**

Replace `server/src/test/setup.js`:

```js
process.env.NODE_ENV = 'test';

import { beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet;

beforeAll(async () => {
  // A REPLICA SET, not a standalone server: transactions require one.
  // singleFork in vitest.config.js means this runs once for the whole suite.
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(replSet.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});
```

Create `server/src/test/helpers.js`:

```js
import mongoose from 'mongoose';

/** Empty every collection between tests without dropping indexes. */
export async function clearDatabase() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

/** Ensure declared indexes exist — unique constraints are inert without this. */
export async function syncIndexes() {
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}
```

`syncIndexes()` matters more than it looks: Mongoose builds indexes lazily, and a uniqueness test that never calls it passes for the wrong reason.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace server`
Expected: PASS — 7 tests. The first run downloads a MongoDB binary and may take a minute.

If the rollback test fails with "Transaction numbers are only allowed on a replica set member or mongos", `MongoMemoryReplSet` was not used — check `setup.js`.

- [ ] **Step 7: Commit**

```bash
git add server/
git commit -m "$(cat <<'EOF'
test: run suite against an in-memory replica set, proving transactions work

Every invariant in the spec — capacity guards, stock deduction, the intake
transaction — needs multi-document transactions, and those need a replica
set. A plain mongodb-memory-server instance is standalone and silently
cannot do them.

The rollback test is the proof: on a standalone server the pre-throw write
would persist and the count would be 1, not 0. Plans 3 and 4 now rest on a
verified assumption rather than a hopeful one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Audit log core

**Files:**
- Create: `server/src/modules/audit/audit.model.js`, `server/src/modules/audit/audit.service.js`
- Test: `server/src/modules/audit/audit.test.js`

**Interfaces:**
- Consumes: `withTransaction` (Task 4), `clearDatabase`, `syncIndexes` (Task 4)
- Produces: `recordAudit({ actor_id, actor_role, action, module, record_id, before, after, session? }): Promise<AuditLog>`

**Why now:** requirements §15 lists the fields every audit record must carry. Building this before the first mutating endpoint means auditing is available from the very first write, instead of being retrofitted across routes later.

- [ ] **Step 1: Write the failing test**

Create `server/src/modules/audit/audit.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { recordAudit } from './audit.service.js';
import { AuditLog } from './audit.model.js';
import { withTransaction } from '../../core/transaction.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

describe('recordAudit', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  const base = () => ({
    actor_id: new mongoose.Types.ObjectId(),
    actor_role: 'admin',
    action: 'camp.create',
    module: 'camps',
    record_id: new mongoose.Types.ObjectId(),
  });

  it('stores every field required by requirements section 15', async () => {
    const input = { ...base(), before: null, after: { name: 'Camp A', capacity: 100 } };
    const saved = await recordAudit(input);

    expect(saved.actor_id.toString()).toBe(input.actor_id.toString());
    expect(saved.actor_role).toBe('admin');
    expect(saved.action).toBe('camp.create');
    expect(saved.module).toBe('camps');
    expect(saved.record_id.toString()).toBe(input.record_id.toString());
    expect(saved.after).toEqual({ name: 'Camp A', capacity: 100 });
    expect(saved.createdAt).toBeInstanceOf(Date);
  });

  it('records previous and new values for an update', async () => {
    const saved = await recordAudit({
      ...base(),
      action: 'camp.update',
      before: { beneficiary_capacity: 100 },
      after: { beneficiary_capacity: 250 },
    });
    expect(saved.before).toEqual({ beneficiary_capacity: 100 });
    expect(saved.after).toEqual({ beneficiary_capacity: 250 });
  });

  it('joins an enclosing transaction and rolls back with it', async () => {
    await expect(
      withTransaction(async (session) => {
        await recordAudit({ ...base(), session });
        throw new Error('caller failed');
      })
    ).rejects.toThrow('caller failed');

    // An audit entry for an action that never happened would be a lie.
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('strips sensitive keys from recorded values', async () => {
    const saved = await recordAudit({
      ...base(),
      after: { email: 'a@b.com', password: 'hunter2', password_hash: '$2a$12$x', aadhaar: '234567890124' },
    });
    expect(saved.after).toEqual({ email: 'a@b.com' });
  });

  it('rejects an entry missing its actor', async () => {
    await expect(recordAudit({ ...base(), actor_id: undefined })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — cannot resolve `./audit.service.js`.

- [ ] **Step 3: Implement the model**

Create `server/src/modules/audit/audit.model.js`:

```js
import mongoose from 'mongoose';

// Fields mandated by requirements §15: audit id, actor, role, action, module,
// record id, timestamp, previous value, new value.
const auditLogSchema = new mongoose.Schema(
  {
    actor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actor_role: {
      type: String,
      required: true,
      enum: ['admin', 'camp_official', 'affected_person', 'donor', 'system'],
    },
    action: { type: String, required: true, index: true },
    module: { type: String, required: true, index: true },
    record_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'audit_logs' }
);

// Audit records are append-only. Nothing in the application may edit or delete one.
auditLogSchema.pre('findOneAndUpdate', function block(next) {
  next(new Error('Audit logs are immutable.'));
});
auditLogSchema.pre('updateOne', function block(next) {
  next(new Error('Audit logs are immutable.'));
});

auditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
```

- [ ] **Step 4: Implement the service**

Create `server/src/modules/audit/audit.service.js`:

```js
import { AuditLog } from './audit.model.js';

// An audit trail must never become a second copy of the secrets it describes.
const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'refresh_token',
  'token',
  'aadhaar',
  'aadhaar_enc',
  'aadhaar_hash',
]);

function scrub(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(scrub);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(k)) continue;
    out[k] = scrub(v);
  }
  return out;
}

/**
 * Write one audit record.
 * Pass `session` when the audited action is itself transactional, so the audit
 * entry commits or rolls back together with the change it describes.
 */
export async function recordAudit({
  actor_id,
  actor_role,
  action,
  module,
  record_id,
  before = null,
  after = null,
  ip = null,
  session,
}) {
  const [doc] = await AuditLog.create(
    [
      {
        actor_id,
        actor_role,
        action,
        module,
        record_id,
        before: scrub(before),
        after: scrub(after),
        ip,
      },
    ],
    session ? { session } : {}
  );
  return doc;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test --workspace server`
Expected: PASS — 12 tests total.

- [ ] **Step 6: Commit**

```bash
git add server/
git commit -m "$(cat <<'EOF'
feat: add append-only audit log core

Carries every field requirements section 15 mandates: actor, role, action,
module, record id, timestamp, and previous/new values.

Two deliberate properties. Audit writes accept a session so they commit or
roll back with the action they describe — an audit entry for an action that
never happened would be a lie. And recorded values are scrubbed of
passwords, tokens and Aadhaar data, so the audit trail never becomes a
second copy of the secrets it describes.

Built before the first mutating endpoint so auditing is available from the
first write rather than retrofitted across routes later.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: User model and signup

**Files:**
- Create: `shared/src/schemas/auth.schema.js`
- Create: `server/src/modules/auth/user.model.js`, `auth.service.js`, `auth.controller.js`, `auth.routes.js`
- Create: `server/src/middleware/validate.js`
- Modify: `server/src/app.js`, `shared/src/index.js`
- Test: `shared/src/schemas/auth.schema.test.js`, `server/src/modules/auth/auth.signup.test.js`

**Interfaces:**
- Consumes: `AppError`, `ERROR_CODES` (Task 3), `recordAudit` (Task 5)
- Produces:
  - `signupSchema`, `loginSchema` — zod schemas in `@frp/shared`
  - `validate(schema, source='body')` — Express middleware
  - `User` model with `comparePassword(plain): Promise<boolean>` and `toSafeJSON()`
  - `signup(input, meta): Promise<{ user }>`
  - `POST /api/auth/signup`

**The rule from requirements §4:** all four roles share one signup form. A `camp_official` signup lands in `pending_approval` because §4 says officials are "created by Admin, or self-signup approved by Admin". Everyone else is active immediately — §16 requires an affected person to sign up and log in with no OTP step.

- [ ] **Step 1: Write the failing schema test**

Create `shared/src/schemas/auth.schema.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { signupSchema, loginSchema } from './auth.schema.js';

const valid = {
  name: 'Asha Kumari',
  mobile: '9876543210',
  password: 'correct horse battery',
  role: 'affected_person',
};

describe('signupSchema', () => {
  it('accepts a signup with a mobile and no email', () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a signup with an email and no mobile', () => {
    const { mobile, ...rest } = valid;
    expect(signupSchema.safeParse({ ...rest, email: 'asha@example.org' }).success).toBe(true);
  });

  it('rejects a signup with neither mobile nor email', () => {
    const { mobile, ...rest } = valid;
    const result = signupSchema.safeParse(rest);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error.issues)).toMatch(/mobile or an email/i);
  });

  it('requires a ten-digit Indian mobile starting 6 to 9', () => {
    expect(signupSchema.safeParse({ ...valid, mobile: '1234567890' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, mobile: '98765' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, mobile: '+919876543210' }).success).toBe(true);
  });

  it('requires a password of at least twelve characters', () => {
    expect(signupSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
  });

  it('accepts only the four defined roles and rejects volunteer', () => {
    for (const role of ['admin', 'camp_official', 'affected_person', 'donor']) {
      expect(signupSchema.safeParse({ ...valid, role }).success).toBe(true);
    }
    expect(signupSchema.safeParse({ ...valid, role: 'volunteer' }).success).toBe(false);
  });

  it('trims the name and lowercases the email', () => {
    const parsed = signupSchema.parse({ ...valid, name: '  Asha  ', email: 'ASHA@Example.ORG' });
    expect(parsed.name).toBe('Asha');
    expect(parsed.email).toBe('asha@example.org');
  });
});

describe('loginSchema', () => {
  it('accepts an identifier and password', () => {
    expect(loginSchema.safeParse({ identifier: 'asha@example.org', password: 'x'.repeat(12) }).success).toBe(true);
  });

  it('rejects a blank identifier', () => {
    expect(loginSchema.safeParse({ identifier: '', password: 'x'.repeat(12) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace shared`
Expected: FAIL — cannot resolve `./auth.schema.js`.

- [ ] **Step 3: Implement the schemas**

Create `shared/src/schemas/auth.schema.js`:

```js
import { z } from 'zod';

export const ROLES = ['admin', 'camp_official', 'affected_person', 'donor'];

// Indian mobile: optional +91 or 0 prefix, then 10 digits starting 6-9.
const mobile = z
  .string()
  .trim()
  .regex(/^(?:\+91|0)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number.')
  .transform((v) => v.replace(/^(?:\+91|0)/, ''));

export const signupSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required.').max(120),
    mobile: mobile.optional(),
    email: z.string().trim().toLowerCase().email('Enter a valid email address.').optional(),
    // Length beats character-class rules: a long passphrase is stronger than
    // "Pa$$w0rd" and far likelier to be remembered by a camp official at 3am.
    password: z.string().min(12, 'Use at least 12 characters.').max(200),
    role: z.enum(ROLES, { message: 'Select a valid role.' }),
  })
  .refine((d) => Boolean(d.mobile || d.email), {
    message: 'Provide a mobile or an email address.',
    path: ['mobile'],
  });

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your mobile number or email.'),
  password: z.string().min(1, 'Enter your password.'),
});
```

Modify `shared/src/index.js`:

```js
export * from './aadhaar.js';
export * from './priority.js';
export * from './schemas/auth.schema.js';
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace shared`
Expected: PASS — 9 new tests.

- [ ] **Step 5: Write the failing signup test**

Create `server/src/modules/auth/auth.signup.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User } from './user.model.js';
import { AuditLog } from '../audit/audit.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();
const body = {
  name: 'Asha Kumari',
  mobile: '9876543210',
  password: 'correct horse battery',
  role: 'affected_person',
};

describe('POST /api/auth/signup', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates an active affected person', async () => {
    const res = await request(app).post('/api/auth/signup').send(body);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Asha Kumari', role: 'affected_person', status: 'active' });
    expect(res.body.user.id).toBeTruthy();
  });

  it('never returns the password or its hash', async () => {
    const res = await request(app).post('/api/auth/signup').send(body);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/correct horse battery/);
    expect(serialized).not.toMatch(/password/i);
  });

  it('stores a bcrypt hash, never the plaintext', async () => {
    await request(app).post('/api/auth/signup').send(body);
    const user = await User.findOne({ mobile: '9876543210' }).select('+password_hash');
    expect(user.password_hash).not.toBe(body.password);
    expect(user.password_hash).toMatch(/^\$2[aby]\$12\$/); // bcrypt, cost 12
  });

  it('places a camp official in pending_approval', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...body, mobile: '9876543211', role: 'camp_official' });
    expect(res.status).toBe(201);
    expect(res.body.user.status).toBe('pending_approval');
  });

  it('rejects a duplicate mobile with a 409 and a field-level detail', async () => {
    await request(app).post('/api/auth/signup').send(body);
    const res = await request(app).post('/api/auth/signup').send({ ...body, name: 'Someone Else' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.some((d) => d.path === 'mobile')).toBe(true);
  });

  it('rejects a duplicate email regardless of casing', async () => {
    const withEmail = { ...body, mobile: undefined, email: 'asha@example.org' };
    await request(app).post('/api/auth/signup').send(withEmail);
    const res = await request(app).post('/api/auth/signup').send({ ...withEmail, email: 'ASHA@EXAMPLE.ORG' });
    expect(res.status).toBe(409);
  });

  it('returns field-level validation errors the form can display', async () => {
    const res = await request(app).post('/api/auth/signup').send({ ...body, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.some((d) => d.path === 'password')).toBe(true);
  });

  it('rejects a volunteer role, which does not exist', async () => {
    const res = await request(app).post('/api/auth/signup').send({ ...body, role: 'volunteer' });
    expect(res.status).toBe(400);
  });

  it('writes an audit record', async () => {
    await request(app).post('/api/auth/signup').send(body);
    const entry = await AuditLog.findOne({ action: 'user.signup' });
    expect(entry).toBeTruthy();
    expect(entry.module).toBe('auth');
    expect(JSON.stringify(entry.after)).not.toMatch(/password/i);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — cannot resolve `./user.model.js`.

- [ ] **Step 7: Implement the validation middleware**

Create `server/src/middleware/validate.js`:

```js
import { AppError } from '../core/errors.js';

/**
 * Validate and REPLACE req[source] with the parsed result, so downstream code
 * only ever sees coerced, trimmed, known-good data.
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        AppError.badRequest(
          'Please correct the highlighted fields.',
          result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
        )
      );
    }
    req[source] = result.data;
    next();
  };
}
```

- [ ] **Step 8: Implement the User model**

Create `server/src/modules/auth/user.model.js`:

```js
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES } from '@frp/shared';

export const BCRYPT_COST = 12;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Sparse so many users may omit one identifier while the other stays unique.
    mobile: { type: String, default: undefined, trim: true },
    email: { type: String, default: undefined, trim: true, lowercase: true },
    // select:false means the hash never rides along on an ordinary query.
    password_hash: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: ROLES, index: true },
    status: {
      type: String,
      required: true,
      enum: ['active', 'pending_approval', 'rejected', 'disabled'],
      default: 'active',
      index: true,
    },
    assigned_camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', default: null, index: true },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approved_at: { type: Date, default: null },
    last_login_at: { type: Date, default: null },
  },
  { timestamps: true, collection: 'users' }
);

userSchema.index({ mobile: 1 }, { unique: true, sparse: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.password_hash);
};

/** The ONLY shape a user may be serialized in for a response. */
userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    mobile: this.mobile ?? null,
    email: this.email ?? null,
    role: this.role,
    status: this.status,
    assigned_camp_id: this.assigned_camp_id ? this.assigned_camp_id.toString() : null,
  };
};

export async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export const User = mongoose.model('User', userSchema);
```

- [ ] **Step 9: Implement the signup service, controller and routes**

Create `server/src/modules/auth/auth.service.js`:

```js
import { User, hashPassword } from './user.model.js';
import { recordAudit } from '../audit/audit.service.js';

/**
 * Requirements §4: one signup flow for all four roles.
 * Camp officials self-signup into pending_approval because §4 says they are
 * "created by Admin, or self-signup approved by Admin". Everyone else is
 * active at once — §16 requires signup and login with no OTP step.
 */
export async function signup({ name, mobile, email, password, role }, { ip } = {}) {
  const password_hash = await hashPassword(password);
  const status = role === 'camp_official' ? 'pending_approval' : 'active';

  const user = await User.create({ name, mobile, email, password_hash, role, status });

  await recordAudit({
    actor_id: user._id,
    actor_role: role,
    action: 'user.signup',
    module: 'auth',
    record_id: user._id,
    after: { name, role, status },
    ip,
  });

  return { user };
}
```

Create `server/src/modules/auth/auth.controller.js`:

```js
import * as authService from './auth.service.js';

export async function signupHandler(req, res) {
  const { user } = await authService.signup(req.body, { ip: req.ip });
  res.status(201).json({ user: user.toSafeJSON() });
}
```

Create `server/src/modules/auth/auth.routes.js`:

```js
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { signupSchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { signupHandler } from './auth.controller.js';

// Credential endpoints are the ones worth brute-forcing, so they are limited.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again shortly.', details: [] } },
});

export const authRouter = Router();
authRouter.post('/signup', authLimiter, validate(signupSchema), signupHandler);
```

Modify `server/src/app.js` — add the import and mount the router above `notFoundHandler`:

```js
import { authRouter } from './modules/auth/auth.routes.js';
// ...
  app.use('/api/auth', authRouter);
// ...
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npm test --workspace server`
Expected: PASS — 9 new tests.

The rate limiter allows 20 requests per 15 minutes per IP; the suite stays under that. If a later task pushes past it, set `limit: 1000` when `NODE_ENV === 'test'`.

- [ ] **Step 11: Commit**

```bash
git add shared/ server/
git commit -m "$(cat <<'EOF'
feat: add user model and common signup for all four roles

One signup flow for admin, camp official, affected person and donor, as
requirements section 4 specifies. Camp officials land in pending_approval
because section 4 says they are created by Admin or self-signup approved by
Admin; everyone else is active immediately, since section 16 requires
signup and login with no OTP step.

Passwords are bcrypt cost 12 and the hash column is select:false, so it
cannot ride along on an ordinary query. Users are serialized only through
toSafeJSON, and tests assert the plaintext and the word "password" never
appear in a response body.

Minimum length is 12 characters with no character-class rules: a long
passphrase is stronger than Pa$$w0rd and likelier to be remembered by a
camp official at 3am.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Login, access token, and rotating refresh token

**Files:**
- Create: `server/src/modules/auth/refreshToken.model.js`, `server/src/core/tokens.js`
- Modify: `server/src/modules/auth/auth.service.js`, `auth.controller.js`, `auth.routes.js`
- Test: `server/src/modules/auth/auth.login.test.js`, `auth.refresh.test.js`

**Interfaces:**
- Consumes: `User`, `AppError`, `ERROR_CODES`, `recordAudit`, `withTransaction`
- Produces:
  - `signAccessToken(user): string`, `verifyAccessToken(token): payload`
  - `issueRefreshToken(userId): Promise<string>`, `rotateRefreshToken(raw): Promise<{ user, token }>`, `revokeRefreshToken(raw): Promise<void>`
  - `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`

**Two decisions worth understanding.** Refresh tokens are stored **hashed**, so a leaked database dump cannot be replayed as a live session. And reuse of an already-rotated token revokes the entire family: that is the standard signal of a stolen token, and the safe response is to end every session for that user rather than to serve the thief.

- [ ] **Step 1: Write the failing login test**

Create `server/src/modules/auth/auth.login.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User } from './user.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();
const password = 'correct horse battery';
const signup = (over = {}) =>
  request(app).post('/api/auth/signup').send({
    name: 'Asha Kumari', mobile: '9876543210', password, role: 'affected_person', ...over,
  });

describe('POST /api/auth/login', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('logs in with a mobile number and returns an access token', async () => {
    await signup();
    const res = await request(app).post('/api/auth/login').send({ identifier: '9876543210', password });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toEqual(expect.any(String));
    expect(res.body.user.role).toBe('affected_person');
  });

  it('logs in with an email address', async () => {
    await signup({ mobile: undefined, email: 'asha@example.org' });
    const res = await request(app).post('/api/auth/login').send({ identifier: 'ASHA@example.org', password });
    expect(res.status).toBe(200);
  });

  it('sets an httpOnly refresh cookie that javascript cannot read', async () => {
    await signup();
    const res = await request(app).post('/api/auth/login').send({ identifier: '9876543210', password });
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('refresh_token='));
    expect(cookie).toBeTruthy();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('never puts the refresh token in the response body', async () => {
    await signup();
    const res = await request(app).post('/api/auth/login').send({ identifier: '9876543210', password });
    expect(res.body).not.toHaveProperty('refresh_token');
  });

  it('rejects a wrong password with 401 and a generic message', async () => {
    await signup();
    const res = await request(app).post('/api/auth/login').send({ identifier: '9876543210', password: 'wrong password!!' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    // Must not reveal whether the account exists.
    expect(res.body.error.message).not.toMatch(/password is incorrect|no such user/i);
  });

  it('gives an unknown identifier the same response as a wrong password', async () => {
    await signup();
    const unknown = await request(app).post('/api/auth/login').send({ identifier: '9000000000', password });
    const wrong = await request(app).post('/api/auth/login').send({ identifier: '9876543210', password: 'wrong password!!' });
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body.error.code).toBe(wrong.body.error.code);
  });

  it('refuses a camp official awaiting approval, with an explanatory code', async () => {
    await signup({ mobile: '9876543212', role: 'camp_official' });
    const res = await request(app).post('/api/auth/login').send({ identifier: '9876543212', password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_PENDING_APPROVAL');
  });

  it('refuses a disabled account', async () => {
    await signup();
    await User.updateOne({ mobile: '9876543210' }, { status: 'disabled' });
    const res = await request(app).post('/api/auth/login').send({ identifier: '9876543210', password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('records the login timestamp', async () => {
    await signup();
    await request(app).post('/api/auth/login').send({ identifier: '9876543210', password });
    const user = await User.findOne({ mobile: '9876543210' });
    expect(user.last_login_at).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — 404, because `/api/auth/login` is not mounted.

- [ ] **Step 3: Implement the token utilities**

Create `server/src/core/tokens.js`:

```js
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      camp_id: user.assigned_camp_id ? user.assigned_camp_id.toString() : null,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

/** Opaque, high-entropy refresh token. Not a JWT: it must be revocable. */
export function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

/**
 * Hash before storing. A leaked database dump then contains no usable session.
 * SHA-256 is right here, unlike for passwords: the token already has 384 bits
 * of entropy, so there is nothing to brute-force and no need to be slow.
 */
export function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
```

- [ ] **Step 4: Implement the refresh token model**

Create `server/src/modules/auth/refreshToken.model.js`:

```js
import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token_hash: { type: String, required: true, unique: true },
    // Every token descends from one login. Reuse revokes the whole family.
    family_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    expires_at: { type: Date, required: true },
    revoked_at: { type: Date, default: null },
    replaced_by: { type: String, default: null },
  },
  { timestamps: true, collection: 'refresh_tokens' }
);

// MongoDB reaps expired documents automatically; no cleanup job needed.
refreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
```

- [ ] **Step 5: Implement login in the service**

Add to `server/src/modules/auth/auth.service.js`:

```js
import mongoose from 'mongoose';
import { AppError, ERROR_CODES } from '../../core/errors.js';
import { RefreshToken } from './refreshToken.model.js';
import {
  signAccessToken, generateRefreshToken, hashRefreshToken, REFRESH_TOKEN_TTL_MS,
} from '../../core/tokens.js';

export async function issueRefreshToken(userId, familyId = new mongoose.Types.ObjectId()) {
  const raw = generateRefreshToken();
  await RefreshToken.create({
    user_id: userId,
    token_hash: hashRefreshToken(raw),
    family_id: familyId,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return raw;
}

export async function login({ identifier, password }, { ip } = {}) {
  const query = identifier.includes('@')
    ? { email: identifier.toLowerCase() }
    : { mobile: identifier.replace(/^(?:\+91|0)/, '') };

  const user = await User.findOne(query).select('+password_hash');

  // Identical response whether the account is missing or the password is wrong,
  // so this endpoint cannot be used to enumerate who is registered.
  const invalid = new AppError(401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid credentials.');
  if (!user) {
    // Spend comparable time so timing does not leak account existence either.
    await new Promise((r) => setTimeout(r, 120));
    throw invalid;
  }
  if (!(await user.comparePassword(password))) throw invalid;

  if (user.status === 'pending_approval') {
    throw new AppError(403, ERROR_CODES.ACCOUNT_PENDING_APPROVAL,
      'Your camp official account is awaiting administrator approval.');
  }
  if (user.status === 'disabled' || user.status === 'rejected') {
    throw new AppError(403, ERROR_CODES.ACCOUNT_DISABLED, 'This account is not active.');
  }

  user.last_login_at = new Date();
  await user.save();

  const access_token = signAccessToken(user);
  const refresh_token = await issueRefreshToken(user._id);

  await recordAudit({
    actor_id: user._id, actor_role: user.role, action: 'user.login',
    module: 'auth', record_id: user._id, ip,
  });

  return { user, access_token, refresh_token };
}
```

- [ ] **Step 6: Add the controller and route**

Add to `server/src/modules/auth/auth.controller.js`:

```js
import { REFRESH_TOKEN_TTL_MS } from '../../core/tokens.js';
import { isProd } from '../../config/env.js';

export const REFRESH_COOKIE = 'refresh_token';

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,      // javascript cannot read it, so XSS cannot steal it
    sameSite: 'strict',  // not sent cross-site, so CSRF cannot use it
    secure: isProd,      // HTTPS only in production
    path: '/api/auth',   // sent only to auth endpoints
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

export async function loginHandler(req, res) {
  const { user, access_token, refresh_token } = await authService.login(req.body, { ip: req.ip });
  setRefreshCookie(res, refresh_token);
  res.json({ user: user.toSafeJSON(), access_token });
}
```

Add to `server/src/modules/auth/auth.routes.js`:

```js
import { loginSchema } from '@frp/shared';
import { loginHandler } from './auth.controller.js';

authRouter.post('/login', authLimiter, validate(loginSchema), loginHandler);
```

- [ ] **Step 7: Run the login tests to verify they pass**

Run: `npm test --workspace server`
Expected: PASS — 9 new tests.

- [ ] **Step 8: Write the failing refresh/logout test**

Create `server/src/modules/auth/auth.refresh.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { RefreshToken } from './refreshToken.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();
const password = 'correct horse battery';

async function loginAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/signup').send({
    name: 'Asha Kumari', mobile: '9876543210', password, role: 'affected_person',
  });
  const res = await agent.post('/api/auth/login').send({ identifier: '9876543210', password });
  return { agent, cookie: res.headers['set-cookie'] };
}

describe('POST /api/auth/refresh', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('exchanges a valid refresh cookie for a new access token', async () => {
    const { agent } = await loginAgent();
    const res = await agent.post('/api/auth/refresh').send();
    expect(res.status).toBe(200);
    expect(res.body.access_token).toEqual(expect.any(String));
  });

  it('rotates the token, so the old one stops working', async () => {
    const { agent, cookie } = await loginAgent();
    await agent.post('/api/auth/refresh').send();           // rotates
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', cookie).send();
    expect(replay.status).toBe(401);
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const { agent, cookie } = await loginAgent();
    const rotated = await agent.post('/api/auth/refresh').send();
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).send(); // theft signal

    // The legitimate current token must also stop working: we cannot tell
    // the thief from the victim, so every session for this user ends.
    const after = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', rotated.headers['set-cookie'])
      .send();
    expect(after.status).toBe(401);

    const live = await RefreshToken.countDocuments({ revoked_at: null });
    expect(live).toBe(0);
  });

  it('rejects a request with no cookie', async () => {
    const res = await request(app).post('/api/auth/refresh').send();
    expect(res.status).toBe(401);
  });

  it('rejects a forged token value', async () => {
    const res = await request(app).post('/api/auth/refresh').set('Cookie', ['refresh_token=deadbeef']).send();
    expect(res.status).toBe(401);
  });

  it('stores refresh tokens hashed, never in plaintext', async () => {
    const { cookie } = await loginAgent();
    const raw = cookie.find((c) => c.startsWith('refresh_token=')).split(';')[0].split('=')[1];
    expect(await RefreshToken.findOne({ token_hash: raw })).toBeNull();
    expect(await RefreshToken.countDocuments()).toBe(1);
  });
});

describe('POST /api/auth/logout', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('revokes the token and clears the cookie', async () => {
    const { agent } = await loginAgent();
    const res = await agent.post('/api/auth/logout').send();
    expect(res.status).toBe(204);
    expect(await RefreshToken.countDocuments({ revoked_at: null })).toBe(0);
    const retry = await agent.post('/api/auth/refresh').send();
    expect(retry.status).toBe(401);
  });

  it('succeeds even with no session, so logout is always safe to call', async () => {
    const res = await request(app).post('/api/auth/logout').send();
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 9: Run it to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — 404 on `/api/auth/refresh`.

- [ ] **Step 10: Implement rotation and revocation**

Add to `server/src/modules/auth/auth.service.js`:

```js
export async function rotateRefreshToken(raw) {
  const unauthorized = new AppError(401, ERROR_CODES.TOKEN_INVALID, 'Your session has expired. Please sign in again.');
  if (!raw) throw unauthorized;

  const existing = await RefreshToken.findOne({ token_hash: hashRefreshToken(raw) });
  if (!existing) throw unauthorized;

  // A token that was already rotated is being replayed. Either it was stolen
  // or it leaked; we cannot tell which, so we end every session in the family.
  if (existing.revoked_at) {
    await RefreshToken.updateMany(
      { family_id: existing.family_id, revoked_at: null },
      { revoked_at: new Date() }
    );
    throw unauthorized;
  }

  if (existing.expires_at.getTime() < Date.now()) throw unauthorized;

  const user = await User.findById(existing.user_id);
  if (!user || user.status !== 'active') throw unauthorized;

  const next = await issueRefreshToken(user._id, existing.family_id);
  existing.revoked_at = new Date();
  existing.replaced_by = hashRefreshToken(next);
  await existing.save();

  return { user, access_token: signAccessToken(user), refresh_token: next };
}

export async function revokeRefreshToken(raw) {
  if (!raw) return;
  await RefreshToken.updateOne(
    { token_hash: hashRefreshToken(raw), revoked_at: null },
    { revoked_at: new Date() }
  );
}
```

Add to `server/src/modules/auth/auth.controller.js`:

```js
export async function refreshHandler(req, res) {
  const { user, access_token, refresh_token } = await authService.rotateRefreshToken(
    req.cookies?.[REFRESH_COOKIE]
  );
  setRefreshCookie(res, refresh_token);
  res.json({ user: user.toSafeJSON(), access_token });
}

export async function logoutHandler(req, res) {
  await authService.revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.status(204).send();
}
```

Add to `server/src/modules/auth/auth.routes.js`:

```js
import { refreshHandler, logoutHandler } from './auth.controller.js';

authRouter.post('/refresh', refreshHandler);
authRouter.post('/logout', logoutHandler);
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npm test --workspace server`
Expected: PASS — 8 new tests.

- [ ] **Step 12: Commit**

```bash
git add server/
git commit -m "$(cat <<'EOF'
feat: add login with rotating, revocable refresh tokens

Access tokens live 15 minutes; refresh tokens live 7 days in an httpOnly,
SameSite=strict cookie scoped to /api/auth, so javascript cannot read them
and cross-site requests cannot send them.

Refresh tokens are opaque and stored SHA-256 hashed, so a leaked database
dump contains no replayable session. They are not JWTs precisely because
they must be revocable.

Replaying an already-rotated token revokes the entire token family. That
replay is the standard signature of a stolen token, and since we cannot
distinguish the thief from the victim, the safe response is to end every
session for that user rather than to serve the thief.

Login returns an identical 401 for an unknown identifier and a wrong
password, with a matching delay, so the endpoint cannot enumerate which
flood victims are registered.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Authentication and authorization middleware

**Files:**
- Create: `server/src/middleware/authenticate.js`, `server/src/middleware/authorize.js`
- Modify: `server/src/modules/auth/auth.controller.js`, `auth.routes.js`
- Test: `server/src/middleware/auth.middleware.test.js`

**Interfaces:**
- Consumes: `verifyAccessToken`, `User`, `AppError`
- Produces:
  - `authenticate` — populates `req.user` (`{ id, role, camp_id }`) or throws 401
  - `authorize(...roles)` — throws 403 unless `req.user.role` is listed
  - `requireOwnCamp(getCampId)` — a camp official may act only on their assigned camp
  - `GET /api/auth/me`

**Requirements §12** is explicit that authorization is enforced server-side, not only in frontend route guards. `requireOwnCamp` is the piece a frontend guard fundamentally cannot provide: the browser can hide a button, but only the server can refuse the request.

- [ ] **Step 1: Write the failing test**

Create `server/src/middleware/auth.middleware.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { authenticate } from './authenticate.js';
import { authorize, requireOwnCamp } from './authorize.js';
import { errorHandler } from './errorHandler.js';
import { User, hashPassword } from '../modules/auth/user.model.js';
import { signAccessToken } from '../core/tokens.js';
import { createApp } from '../app.js';
import { clearDatabase, syncIndexes } from '../test/helpers.js';

function harness() {
  const app = express();
  app.use(express.json());
  app.get('/open', authenticate, (req, res) => res.json({ user: req.user }));
  app.get('/admin-only', authenticate, authorize('admin'), (req, res) => res.json({ ok: true }));
  app.get('/staff', authenticate, authorize('admin', 'camp_official'), (req, res) => res.json({ ok: true }));
  app.get('/camps/:campId', authenticate, authorize('admin', 'camp_official'),
    requireOwnCamp((req) => req.params.campId), (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test User',
    mobile: String(9000000000 + Math.floor(Math.random() * 999999999)).slice(0, 10),
    password_hash: await hashPassword('correct horse battery'),
    role,
    status: 'active',
    ...over,
  });
}

describe('authenticate', () => {
  const app = harness();
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('populates req.user from a valid bearer token', async () => {
    const user = await makeUser('admin');
    const res = await request(app).get('/open').set('Authorization', `Bearer ${signAccessToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user._id.toString(), role: 'admin' });
  });

  it('rejects a missing header', async () => {
    const res = await request(app).get('/open');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed header', async () => {
    const res = await request(app).get('/open').set('Authorization', 'Token abc');
    expect(res.status).toBe(401);
  });

  it('rejects a tampered token', async () => {
    const user = await makeUser('admin');
    const token = signAccessToken(user);
    const res = await request(app).get('/open').set('Authorization', `Bearer ${token.slice(0, -2)}xy`);
    expect(res.status).toBe(401);
  });

  it('rejects a token whose user has since been disabled', async () => {
    const user = await makeUser('camp_official');
    const token = signAccessToken(user);
    await User.updateOne({ _id: user._id }, { status: 'disabled' });
    const res = await request(app).get('/open').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe('authorize', () => {
  const app = harness();
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('allows a listed role', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${signAccessToken(admin)}`);
    expect(res.status).toBe(200);
  });

  it('refuses an unlisted role with 403, not 401', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${signAccessToken(donor)}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows any of several listed roles', async () => {
    const official = await makeUser('camp_official');
    const res = await request(app).get('/staff').set('Authorization', `Bearer ${signAccessToken(official)}`);
    expect(res.status).toBe(200);
  });

  it('refuses an affected person a staff route', async () => {
    const person = await makeUser('affected_person');
    const res = await request(app).get('/staff').set('Authorization', `Bearer ${signAccessToken(person)}`);
    expect(res.status).toBe(403);
  });
});

describe('requireOwnCamp', () => {
  const app = harness();
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an official act on their assigned camp', async () => {
    const campId = new mongoose.Types.ObjectId();
    const official = await makeUser('camp_official', { assigned_camp_id: campId });
    const res = await request(app).get(`/camps/${campId}`).set('Authorization', `Bearer ${signAccessToken(official)}`);
    expect(res.status).toBe(200);
  });

  it('refuses an official acting on someone else camp', async () => {
    const official = await makeUser('camp_official', { assigned_camp_id: new mongoose.Types.ObjectId() });
    const other = new mongoose.Types.ObjectId();
    const res = await request(app).get(`/camps/${other}`).set('Authorization', `Bearer ${signAccessToken(official)}`);
    expect(res.status).toBe(403);
  });

  it('lets an admin act on any camp', async () => {
    const admin = await makeUser('admin');
    const any = new mongoose.Types.ObjectId();
    const res = await request(app).get(`/camps/${any}`).set('Authorization', `Bearer ${signAccessToken(admin)}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/auth/me', () => {
  const app = createApp();
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('returns the current user without any secret field', async () => {
    const user = await makeUser('donor');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signAccessToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user._id.toString());
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — cannot resolve `./authenticate.js`.

- [ ] **Step 3: Implement `authenticate`**

Create `server/src/middleware/authenticate.js`:

```js
import { verifyAccessToken } from '../core/tokens.js';
import { AppError, ERROR_CODES } from '../core/errors.js';
import { User } from '../modules/auth/user.model.js';

/**
 * Verify the bearer token and load the user.
 *
 * The database lookup is deliberate. A 15-minute access token issued before an
 * account was disabled would otherwise keep working until it expired; checking
 * status on each request means revocation takes effect immediately.
 */
export async function authenticate(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(AppError.unauthenticated('Sign in to continue.'));
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const expired = err?.name === 'TokenExpiredError';
    return next(
      new AppError(
        401,
        expired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.TOKEN_INVALID,
        expired ? 'Your session has expired.' : 'Invalid session.'
      )
    );
  }

  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') {
    return next(AppError.unauthenticated('This account is no longer active.'));
  }

  req.user = {
    id: user._id.toString(),
    role: user.role,
    camp_id: user.assigned_camp_id ? user.assigned_camp_id.toString() : null,
    doc: user,
  };
  next();
}
```

- [ ] **Step 4: Implement `authorize` and `requireOwnCamp`**

Create `server/src/middleware/authorize.js`:

```js
import { AppError } from '../core/errors.js';

/** Allow only the listed roles. 403, not 401: the caller is known, just not permitted. */
export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthenticated());
    if (!roles.includes(req.user.role)) {
      return next(AppError.forbidden('Your role does not have access to this action.'));
    }
    next();
  };
}

/**
 * Restrict a camp official to their own assigned camp.
 *
 * This is the check a frontend guard cannot make. The browser can hide a
 * button; only the server can refuse the request behind it. Admins are
 * unrestricted by design — requirements §4 gives them full administration.
 *
 * @param {(req) => string|null} getCampId reads the target camp id from the request
 */
export function requireOwnCamp(getCampId) {
  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthenticated());
    if (req.user.role === 'admin') return next();

    const target = getCampId(req);
    if (!target) return next(AppError.badRequest('A camp must be specified.'));

    if (!req.user.camp_id || req.user.camp_id !== String(target)) {
      return next(AppError.forbidden('You may only act on the camp you are assigned to.'));
    }
    next();
  };
}
```

- [ ] **Step 5: Add `GET /api/auth/me`**

Add to `server/src/modules/auth/auth.controller.js`:

```js
export async function meHandler(req, res) {
  res.json({ user: req.user.doc.toSafeJSON() });
}
```

Add to `server/src/modules/auth/auth.routes.js`:

```js
import { authenticate } from '../../middleware/authenticate.js';
import { meHandler } from './auth.controller.js';

authRouter.get('/me', authenticate, meHandler);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace server`
Expected: PASS — 15 new tests.

- [ ] **Step 7: Commit**

```bash
git add server/
git commit -m "$(cat <<'EOF'
feat: add server-side authentication and role authorization

Requirements section 12 requires authorization on the server, not only in
frontend route guards. authorize() gates by role; requireOwnCamp() is the
part a frontend guard fundamentally cannot provide — a browser can hide a
button, but only the server can refuse the request behind it.

authenticate() reloads the user on every request rather than trusting the
token payload alone. Without that, a 15-minute access token issued before
an account was disabled would keep working until it expired.

Unlisted roles get 403 rather than 401: the caller is known, just not
permitted, and conflating the two sends the client into a pointless
re-login loop.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Camp official approval and the bootstrap admin seed

**Files:**
- Modify: `server/src/modules/auth/auth.service.js`, `auth.controller.js`, `auth.routes.js`
- Create: `server/src/scripts/seed.js`
- Test: `server/src/modules/auth/auth.approval.test.js`

**Interfaces:**
- Consumes: `authenticate`, `authorize`, `recordAudit`, `User`
- Produces:
  - `listPendingOfficials(): Promise<User[]>`
  - `decideOfficial({ userId, decision, adminId, assigned_camp_id }): Promise<User>`
  - `GET /api/auth/pending-officials`, `POST /api/auth/officials/:id/decision`
  - `npm run seed --workspace server`

**Why the seed matters:** with signup alone there is no way to create the first admin — admins cannot self-approve into existence, and a camp official signup requires an admin to approve it. The seed script breaks that circular dependency, and it is idempotent so re-running it never creates a second admin.

- [ ] **Step 1: Write the failing test**

Create `server/src/modules/auth/auth.approval.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../../app.js';
import { User, hashPassword } from './user.model.js';
import { AuditLog } from '../audit/audit.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();
const password = 'correct horse battery';

const bearer = (user) => ({ Authorization: `Bearer ${signAccessToken(user)}` });

async function makeAdmin() {
  return User.create({
    name: 'Admin', email: 'admin@example.org',
    password_hash: await hashPassword(password), role: 'admin', status: 'active',
  });
}

async function makePendingOfficial(mobile = '9876543212') {
  return User.create({
    name: 'Ravi Official', mobile,
    password_hash: await hashPassword(password),
    role: 'camp_official', status: 'pending_approval',
  });
}

describe('camp official approval', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lists pending officials for an admin', async () => {
    const admin = await makeAdmin();
    await makePendingOfficial();
    const res = await request(app).get('/api/auth/pending-officials').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.officials).toHaveLength(1);
    expect(res.body.officials[0].status).toBe('pending_approval');
  });

  it('refuses the pending list to a non-admin', async () => {
    const official = await makePendingOfficial();
    await User.updateOne({ _id: official._id }, { status: 'active' });
    const active = await User.findById(official._id);
    const res = await request(app).get('/api/auth/pending-officials').set(bearer(active));
    expect(res.status).toBe(403);
  });

  it('approves an official and assigns them a camp', async () => {
    const admin = await makeAdmin();
    const official = await makePendingOfficial();
    const campId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post(`/api/auth/officials/${official._id}/decision`)
      .set(bearer(admin))
      .send({ decision: 'approve', assigned_camp_id: campId });

    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('active');
    expect(res.body.user.assigned_camp_id).toBe(campId);

    const saved = await User.findById(official._id);
    expect(saved.approved_by.toString()).toBe(admin._id.toString());
    expect(saved.approved_at).toBeInstanceOf(Date);
  });

  it('lets an approved official log in, having been refused before', async () => {
    const admin = await makeAdmin();
    const official = await makePendingOfficial();

    const before = await request(app).post('/api/auth/login').send({ identifier: '9876543212', password });
    expect(before.status).toBe(403);

    await request(app).post(`/api/auth/officials/${official._id}/decision`)
      .set(bearer(admin)).send({ decision: 'approve' });

    const after = await request(app).post('/api/auth/login').send({ identifier: '9876543212', password });
    expect(after.status).toBe(200);
  });

  it('rejects an official, who then still cannot log in', async () => {
    const admin = await makeAdmin();
    const official = await makePendingOfficial();

    const res = await request(app).post(`/api/auth/officials/${official._id}/decision`)
      .set(bearer(admin)).send({ decision: 'reject' });
    expect(res.body.user.status).toBe('rejected');

    const login = await request(app).post('/api/auth/login').send({ identifier: '9876543212', password });
    expect(login.status).toBe(403);
  });

  it('refuses to decide on a user who is not a pending official', async () => {
    const admin = await makeAdmin();
    const donor = await User.create({
      name: 'Donor', mobile: '9876543213',
      password_hash: await hashPassword(password), role: 'donor', status: 'active',
    });
    const res = await request(app).post(`/api/auth/officials/${donor._id}/decision`)
      .set(bearer(admin)).send({ decision: 'approve' });
    expect(res.status).toBe(404);
  });

  it('audits the decision with the admin as actor', async () => {
    const admin = await makeAdmin();
    const official = await makePendingOfficial();
    await request(app).post(`/api/auth/officials/${official._id}/decision`)
      .set(bearer(admin)).send({ decision: 'approve' });

    const entry = await AuditLog.findOne({ action: 'user.official_approved' });
    expect(entry.actor_id.toString()).toBe(admin._id.toString());
    expect(entry.before).toEqual({ status: 'pending_approval' });
    expect(entry.after).toMatchObject({ status: 'active' });
  });

  it('validates the decision value', async () => {
    const admin = await makeAdmin();
    const official = await makePendingOfficial();
    const res = await request(app).post(`/api/auth/officials/${official._id}/decision`)
      .set(bearer(admin)).send({ decision: 'maybe' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace server`
Expected: FAIL — 404 on `/api/auth/pending-officials`.

- [ ] **Step 3: Add the decision schema**

Add to `shared/src/schemas/auth.schema.js`:

```js
export const officialDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject'], { message: 'Choose approve or reject.' }),
  assigned_camp_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid camp id.').optional(),
});
```

- [ ] **Step 4: Implement the service functions**

Add to `server/src/modules/auth/auth.service.js`:

```js
export async function listPendingOfficials() {
  return User.find({ role: 'camp_official', status: 'pending_approval' }).sort({ createdAt: 1 });
}

export async function decideOfficial({ userId, decision, assigned_camp_id, adminId, adminRole, ip }) {
  const user = await User.findOne({ _id: userId, role: 'camp_official', status: 'pending_approval' });
  if (!user) throw AppError.notFound('No camp official is awaiting approval with that id.');

  const before = { status: user.status };
  user.status = decision === 'approve' ? 'active' : 'rejected';
  user.approved_by = adminId;
  user.approved_at = new Date();
  if (decision === 'approve' && assigned_camp_id) user.assigned_camp_id = assigned_camp_id;
  await user.save();

  await recordAudit({
    actor_id: adminId,
    actor_role: adminRole,
    action: decision === 'approve' ? 'user.official_approved' : 'user.official_rejected',
    module: 'auth',
    record_id: user._id,
    before,
    after: { status: user.status, assigned_camp_id: user.assigned_camp_id ?? null },
    ip,
  });

  return user;
}
```

- [ ] **Step 5: Add the controller and routes**

Add to `server/src/modules/auth/auth.controller.js`:

```js
export async function pendingOfficialsHandler(req, res) {
  const officials = await authService.listPendingOfficials();
  res.json({ officials: officials.map((u) => u.toSafeJSON()) });
}

export async function officialDecisionHandler(req, res) {
  const user = await authService.decideOfficial({
    userId: req.params.id,
    decision: req.body.decision,
    assigned_camp_id: req.body.assigned_camp_id,
    adminId: req.user.id,
    adminRole: req.user.role,
    ip: req.ip,
  });
  res.json({ user: user.toSafeJSON() });
}
```

Add to `server/src/modules/auth/auth.routes.js`:

```js
import { officialDecisionSchema } from '@frp/shared';
import { authorize } from '../../middleware/authorize.js';
import { pendingOfficialsHandler, officialDecisionHandler } from './auth.controller.js';

authRouter.get('/pending-officials', authenticate, authorize('admin'), pendingOfficialsHandler);
authRouter.post(
  '/officials/:id/decision',
  authenticate,
  authorize('admin'),
  validate(officialDecisionSchema),
  officialDecisionHandler
);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace server`
Expected: PASS — 8 new tests.

- [ ] **Step 7: Write the bootstrap seed script**

Create `server/src/scripts/seed.js`:

```js
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { User, hashPassword } from '../modules/auth/user.model.js';
import { recordAudit } from '../modules/audit/audit.service.js';
import { logger } from '../core/logger.js';

/**
 * Creates the first admin.
 *
 * Signup alone cannot produce one: admins do not self-approve into existence,
 * and a camp official signup needs an admin to approve it. This breaks that
 * circular dependency. Idempotent — re-running never creates a second admin.
 */
async function seedBootstrapAdmin() {
  const { BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_ADMIN_NAME } = env;

  if (!BOOTSTRAP_ADMIN_EMAIL || !BOOTSTRAP_ADMIN_PASSWORD) {
    logger.warn('BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are not set; skipping admin seed.');
    return;
  }

  const existing = await User.findOne({ role: 'admin' });
  if (existing) {
    logger.info(`An admin already exists (${existing.email ?? existing.mobile}); leaving it untouched.`);
    return;
  }

  const admin = await User.create({
    name: BOOTSTRAP_ADMIN_NAME ?? 'Administrator',
    email: BOOTSTRAP_ADMIN_EMAIL,
    password_hash: await hashPassword(BOOTSTRAP_ADMIN_PASSWORD),
    role: 'admin',
    status: 'active',
  });

  await recordAudit({
    actor_id: admin._id,
    actor_role: 'system',
    action: 'user.bootstrap_admin_created',
    module: 'auth',
    record_id: admin._id,
    after: { email: admin.email, role: 'admin' },
  });

  logger.info(`Bootstrap admin created: ${admin.email}`);
  logger.warn('Change this password immediately after first login.');
}

async function main() {
  await connectDb();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await seedBootstrapAdmin();
  await disconnectDb();
}

main().catch((err) => {
  logger.error({ err }, 'seed failed');
  process.exitCode = 1;
});
```

- [ ] **Step 8: Create the server entrypoint**

Create `server/src/server.js`:

```js
import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './core/logger.js';

async function start() {
  await connectDb();
  const app = createApp();
  app.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
}

start().catch((err) => {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
});
```

- [ ] **Step 9: Verify the seed against the real Atlas database**

Copy `.env.example` to `.env`, fill in `MONGODB_URI` and generate the four secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then:

```bash
npm run seed --workspace server
npm run seed --workspace server   # second run must report "already exists"
```

Expected: first run logs "Bootstrap admin created"; the second logs that an admin already exists and creates nothing.

- [ ] **Step 10: Commit**

```bash
git add server/ shared/
git commit -m "$(cat <<'EOF'
feat: add camp official approval and idempotent bootstrap admin seed

Requirements section 4 allows a camp official to self-signup subject to
admin approval. Officials sit in pending_approval, are refused login with
an explanatory code, and become active only when an admin approves them —
optionally assigning the camp they may act on.

The seed exists because signup alone cannot create the first admin: admins
do not self-approve into existence, and an official signup needs an admin
to approve it. Running it twice leaves the existing admin untouched rather
than creating a second one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Client scaffold, API client with automatic token refresh

**Files:**
- Create: `client/` via Vite, `client/src/theme.js`, `client/src/api/client.js`, `client/src/api/auth.js`
- Modify: root `package.json` (already lists `client` in workspaces), `client/vite.config.js`

**Interfaces:**
- Consumes: `POST /api/auth/{login,signup,refresh,logout}`, `GET /api/auth/me`
- Produces:
  - `api` — axios instance that attaches the access token and refreshes once on 401
  - `useLogin()`, `useSignup()`, `useLogout()`, `useMe()` — TanStack Query hooks
  - `setAccessToken(t)`, `getAccessToken()`

**The design point:** the access token lives in a module variable, never in `localStorage`. A token in `localStorage` is readable by any injected script; a token in memory dies with the tab, and the httpOnly refresh cookie silently restores the session on reload.

- [ ] **Step 1: Scaffold the client**

From the repo root:

```bash
npm create vite@latest client -- --template react
npm install --workspace client @mui/material @emotion/react @emotion/styled @mui/icons-material @tanstack/react-query axios react-router-dom zod
npm install --workspace client @frp/shared@*
npm install -D --workspace client vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: Point the dev server at the API**

Replace `client/vite.config.js`:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in dev, so the refresh cookie is sent without CORS exemptions.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
});
```

Create `client/src/test/setup.js`:

```js
import '@testing-library/jest-dom/vitest';
```

Add to `client/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Create the theme**

Create `client/src/theme.js`:

```js
import { createTheme } from '@mui/material/styles';

// Deliberately high-contrast and large-target: this is used on cheap phones,
// in bad light, by stressed people, sometimes on a wet screen.
export const theme = createTheme({
  palette: {
    primary: { main: '#0B5394' },
    secondary: { main: '#0F7B6C' },
    error: { main: '#B3261E' },
    warning: { main: '#B25E02' },
    success: { main: '#1B7F3B' },
    background: { default: '#F6F7F9' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { size: 'large' } },
    MuiTextField: { defaultProps: { fullWidth: true, margin: 'normal' } },
  },
});
```

- [ ] **Step 4: Implement the API client**

Create `client/src/api/client.js`:

```js
import axios from 'axios';

// In memory only. localStorage is readable by any injected script; a variable
// dies with the tab, and the httpOnly refresh cookie restores the session on
// reload without ever exposing a token to javascript.
let accessToken = null;

export const setAccessToken = (t) => { accessToken = t; };
export const getAccessToken = () => accessToken;

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // send the refresh cookie
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Share one refresh across concurrent 401s, so ten parallel requests do not
// fire ten rotations and trip the token-reuse defence.
let refreshing = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const isAuthCall = original?.url?.includes('/auth/login') || original?.url?.includes('/auth/refresh');

    if (status !== 401 || original?._retried || isAuthCall) {
      return Promise.reject(error);
    }

    original._retried = true;
    refreshing ??= api
      .post('/auth/refresh')
      .then(({ data }) => { setAccessToken(data.access_token); return data.access_token; })
      .catch((err) => { setAccessToken(null); throw err; })
      .finally(() => { refreshing = null; });

    try {
      await refreshing;
      return api(original);
    } catch {
      return Promise.reject(error);
    }
  }
);

/** Normalize the server's error envelope into something a form can render. */
export function toFormErrors(error) {
  const envelope = error?.response?.data?.error;
  return {
    code: envelope?.code ?? 'NETWORK',
    message: envelope?.message ?? 'Could not reach the server. Check your connection.',
    fields: Object.fromEntries((envelope?.details ?? []).map((d) => [d.path, d.message])),
  };
}
```

- [ ] **Step 5: Implement the auth query hooks**

Create `client/src/api/auth.js`:

```js
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setAccessToken } from './client.js';

export const meQueryKey = ['auth', 'me'];

export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async () => (await api.get('/auth/me')).data.user,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (credentials) => (await api.post('/auth/login', credentials)).data,
    onSuccess: (data) => {
      setAccessToken(data.access_token);
      qc.setQueryData(meQueryKey, data.user);
    },
  });
}

export function useSignup() {
  return useMutation({
    mutationFn: async (payload) => (await api.post('/auth/signup', payload)).data,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => { await api.post('/auth/logout'); },
    onSettled: () => { setAccessToken(null); qc.clear(); },
  });
}

/**
 * Restore a session on page load. The access token is gone (it lived in
 * memory), but the httpOnly refresh cookie survives, so one refresh call
 * silently signs the user back in.
 */
export async function restoreSession() {
  try {
    const { data } = await api.post('/auth/refresh');
    setAccessToken(data.access_token);
    return data.user;
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add client/ package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat: scaffold client with token-refreshing API layer

The access token lives in a module variable, never in localStorage: a token
in localStorage is readable by any injected script, while one in memory
dies with the tab and the httpOnly refresh cookie silently restores the
session on reload.

The 401 interceptor shares a single in-flight refresh across concurrent
failures. Without that, ten parallel requests would fire ten rotations and
trip the server's token-reuse defence, logging the user out for doing
nothing wrong.

Theme is high-contrast with large touch targets — this runs on cheap phones,
in bad light, used by stressed people.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Login and signup screens, route guards, role layout

**Files:**
- Create: `client/src/features/auth/LoginPage.jsx`, `SignupPage.jsx`
- Create: `client/src/routes/RequireAuth.jsx`, `client/src/layouts/RoleLayout.jsx`
- Create: `client/src/AuthProvider.jsx`
- Modify: `client/src/App.jsx`, `client/src/main.jsx`
- Test: `client/src/features/auth/LoginPage.test.jsx`

**Interfaces:**
- Consumes: `useLogin`, `useSignup`, `useMe`, `restoreSession`, `signupSchema`, `loginSchema`, `toFormErrors`
- Produces:
  - `<AuthProvider>` with `useAuth(): { user, isLoading, logout }`
  - `<RequireAuth roles={[...]}>` route guard
  - `HOME_BY_ROLE` — landing route per role

**Guards are convenience, not security.** Every one of these routes is already enforced server-side by Task 8. The guard exists so users are not shown a screen that will only fail — it is not what keeps anyone out.

- [ ] **Step 1: Write the failing test**

Create `client/src/features/auth/LoginPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './LoginPage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, post: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><LoginPage /></MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LoginPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the fields a user needs', () => {
    renderPage();
    expect(screen.getByLabelText(/mobile number or email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('validates before sending anything to the server', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/enter your mobile number or email/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('submits valid credentials', async () => {
    api.post.mockResolvedValue({ data: { access_token: 'tok', user: { id: '1', role: 'affected_person' } } });
    renderPage();
    await userEvent.type(screen.getByLabelText(/mobile number or email/i), '9876543210');
    await userEvent.type(screen.getByLabelText(/^password/i), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/login', {
        identifier: '9876543210', password: 'correct horse battery',
      })
    );
  });

  it('shows the server message when credentials are rejected', async () => {
    api.post.mockRejectedValue({
      response: { status: 401, data: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.', details: [] } } },
    });
    renderPage();
    await userEvent.type(screen.getByLabelText(/mobile number or email/i), '9876543210');
    await userEvent.type(screen.getByLabelText(/^password/i), 'wrong password!!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });

  it('explains a pending camp official account rather than showing a bare error', async () => {
    api.post.mockRejectedValue({
      response: { status: 403, data: { error: {
        code: 'ACCOUNT_PENDING_APPROVAL',
        message: 'Your camp official account is awaiting administrator approval.',
        details: [] } } },
    });
    renderPage();
    await userEvent.type(screen.getByLabelText(/mobile number or email/i), '9876543212');
    await userEvent.type(screen.getByLabelText(/^password/i), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/awaiting administrator approval/i)).toBeInTheDocument();
  });

  it('keeps what the user typed after a failed attempt', async () => {
    api.post.mockRejectedValue({
      response: { status: 401, data: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.', details: [] } } },
    });
    renderPage();
    const id = screen.getByLabelText(/mobile number or email/i);
    await userEvent.type(id, '9876543210');
    await userEvent.type(screen.getByLabelText(/^password/i), 'wrong password!!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await screen.findByText(/invalid credentials/i);
    // Requirements §13: the UI must not silently lose entered data.
    expect(id).toHaveValue('9876543210');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client`
Expected: FAIL — cannot resolve `./LoginPage.jsx`.

- [ ] **Step 3: Implement the login page**

Create `client/src/features/auth/LoginPage.jsx`:

```jsx
import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Link, Stack, TextField, Typography } from '@mui/material';
import { loginSchema } from '@frp/shared';
import { useLogin } from '../../api/auth.js';
import { toFormErrors } from '../../api/client.js';

export const HOME_BY_ROLE = {
  admin: '/admin',
  camp_official: '/official',
  affected_person: '/',
  donor: '/donor',
};

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const [values, setValues] = useState({ identifier: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);

  const change = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setFormError(null);

    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setFieldErrors({});

    try {
      const data = await login.mutateAsync(parsed.data);
      navigate(HOME_BY_ROLE[data.user.role] ?? '/', { replace: true });
    } catch (err) {
      // Values stay in state, so nothing the user typed is lost (§13).
      const { message, fields } = toFormErrors(err);
      setFormError(message);
      setFieldErrors(fields);
    }
  }

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent>
          <Typography variant="h5" component="h1" gutterBottom>Sign in</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Flood Relief Camp Portal
          </Typography>

          {formError && <Alert severity="error" sx={{ mt: 2 }}>{formError}</Alert>}

          <Box component="form" onSubmit={onSubmit} noValidate>
            <TextField
              label="Mobile number or email"
              value={values.identifier}
              onChange={change('identifier')}
              error={Boolean(fieldErrors.identifier)}
              helperText={fieldErrors.identifier}
              autoComplete="username"
              autoFocus
            />
            <TextField
              label="Password"
              type="password"
              value={values.password}
              onChange={change('password')}
              error={Boolean(fieldErrors.password)}
              helperText={fieldErrors.password}
              autoComplete="current-password"
            />
            <Stack spacing={2} sx={{ mt: 2 }}>
              <Button type="submit" variant="contained" disabled={login.isPending}>
                {login.isPending ? 'Signing in…' : 'Sign in'}
              </Button>
              <Typography variant="body2">
                New here? <Link component={RouterLink} to="/signup">Create an account</Link>
              </Typography>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace client`
Expected: PASS — 6 tests.

- [ ] **Step 5: Implement the signup page**

Create `client/src/features/auth/SignupPage.jsx`:

```jsx
import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Link, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { signupSchema } from '@frp/shared';
import { useSignup } from '../../api/auth.js';
import { toFormErrors } from '../../api/client.js';

// Admin is absent by design: admins are provisioned, not self-registered (§4).
const ROLE_OPTIONS = [
  { value: 'affected_person', label: 'Affected person — I need shelter or relief' },
  { value: 'donor', label: 'Donor or NGO — I want to contribute' },
  { value: 'camp_official', label: 'Camp official — requires administrator approval' },
];

export function SignupPage() {
  const navigate = useNavigate();
  const signup = useSignup();
  const [values, setValues] = useState({
    name: '', mobile: '', email: '', password: '', role: 'affected_person',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [done, setDone] = useState(null);

  const change = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setFormError(null);

    const payload = { ...values, mobile: values.mobile || undefined, email: values.email || undefined };
    const parsed = signupSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setFieldErrors({});

    try {
      const data = await signup.mutateAsync(parsed.data);
      setDone(data.user);
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setFormError(message);
      setFieldErrors(fields);
    }
  }

  if (done) {
    const pending = done.status === 'pending_approval';
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', p: 2 }}>
        <Card sx={{ maxWidth: 460 }}>
          <CardContent>
            <Alert severity={pending ? 'info' : 'success'}>
              {pending
                ? 'Account created. A camp official account must be approved by an administrator before you can sign in. You will be notified once it is approved.'
                : 'Account created. You can sign in now.'}
            </Alert>
            <Button sx={{ mt: 2 }} variant="contained" onClick={() => navigate('/login')}>
              Go to sign in
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 460 }}>
        <CardContent>
          <Typography variant="h5" component="h1" gutterBottom>Create an account</Typography>
          {formError && <Alert severity="error" sx={{ mt: 2 }}>{formError}</Alert>}

          <Box component="form" onSubmit={onSubmit} noValidate>
            <TextField label="Full name" value={values.name} onChange={change('name')}
              error={Boolean(fieldErrors.name)} helperText={fieldErrors.name} autoFocus />
            <TextField label="Mobile number" value={values.mobile} onChange={change('mobile')}
              error={Boolean(fieldErrors.mobile)}
              helperText={fieldErrors.mobile ?? 'Provide a mobile number or an email address.'} />
            <TextField label="Email (optional)" type="email" value={values.email} onChange={change('email')}
              error={Boolean(fieldErrors.email)} helperText={fieldErrors.email} />
            <TextField label="Password" type="password" value={values.password} onChange={change('password')}
              error={Boolean(fieldErrors.password)}
              helperText={fieldErrors.password ?? 'At least 12 characters. A memorable phrase works well.'}
              autoComplete="new-password" />
            <TextField select label="I am registering as" value={values.role} onChange={change('role')}
              error={Boolean(fieldErrors.role)} helperText={fieldErrors.role}>
              {ROLE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </TextField>

            <Stack spacing={2} sx={{ mt: 2 }}>
              <Button type="submit" variant="contained" disabled={signup.isPending}>
                {signup.isPending ? 'Creating account…' : 'Create account'}
              </Button>
              <Typography variant="body2">
                Already registered? <Link component={RouterLink} to="/login">Sign in</Link>
              </Typography>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
```

- [ ] **Step 6: Implement the auth provider and guard**

Create `client/src/AuthProvider.jsx`:

```jsx
import { createContext, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { restoreSession, meQueryKey, useLogout } from './api/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const logoutMutation = useLogout();

  useEffect(() => {
    let cancelled = false;
    // The access token died with the previous page load; the httpOnly refresh
    // cookie did not. One call silently restores the session.
    restoreSession().then((restored) => {
      if (cancelled) return;
      if (restored) qc.setQueryData(meQueryKey, restored);
      setUser(restored);
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [qc]);

  const value = {
    user,
    isLoading,
    setUser,
    logout: async () => { await logoutMutation.mutateAsync(); setUser(null); },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

Create `client/src/routes/RequireAuth.jsx`:

```jsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../AuthProvider.jsx';

/**
 * Route guard. This is a convenience, NOT a security boundary — every one of
 * these routes is enforced server-side by authorize(). It exists so users are
 * not shown a screen that can only fail.
 */
export function RequireAuth({ roles }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}><CircularProgress /></Box>;
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;

  return <Outlet />;
}
```

- [ ] **Step 7: Wire up the app**

Create `client/src/layouts/RoleLayout.jsx`:

```jsx
import { AppBar, Box, Button, Container, Toolbar, Typography } from '@mui/material';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../AuthProvider.jsx';

const ROLE_LABEL = {
  admin: 'Administrator',
  camp_official: 'Camp Official',
  affected_person: 'Relief Portal',
  donor: 'Donor',
};

export function RoleLayout() {
  const { user, logout } = useAuth();
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Flood Relief · {ROLE_LABEL[user?.role] ?? ''}
          </Typography>
          <Typography variant="body2" sx={{ mr: 2 }}>{user?.name}</Typography>
          <Button color="inherit" onClick={logout}>Sign out</Button>
        </Toolbar>
      </AppBar>
      <Container sx={{ py: 3 }}><Outlet /></Container>
    </Box>
  );
}
```

Replace `client/src/App.jsx`:

```jsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { theme } from './theme.js';
import { AuthProvider } from './AuthProvider.jsx';
import { RequireAuth } from './routes/RequireAuth.jsx';
import { RoleLayout } from './layouts/RoleLayout.jsx';
import { LoginPage } from './features/auth/LoginPage.jsx';
import { SignupPage } from './features/auth/SignupPage.jsx';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// Placeholder home screens. Plan 2 replaces these with the landing page,
// camp management, and the admin dashboard.
const Placeholder = ({ title }) => <h2>{title}</h2>;

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />

              <Route element={<RequireAuth />}>
                <Route element={<RoleLayout />}>
                  <Route path="/" element={<Placeholder title="Relief Portal" />} />
                  <Route path="/donor" element={<Placeholder title="Donor" />} />
                </Route>
              </Route>

              <Route element={<RequireAuth roles={['admin']} />}>
                <Route element={<RoleLayout />}>
                  <Route path="/admin" element={<Placeholder title="Administrator" />} />
                </Route>
              </Route>

              <Route element={<RequireAuth roles={['camp_official', 'admin']} />}>
                <Route element={<RoleLayout />}>
                  <Route path="/official" element={<Placeholder title="Camp Official" />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
```

Replace `client/src/main.jsx`:

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
```

- [ ] **Step 8: Run all tests**

Run: `npm test` (from the repo root — runs all three workspaces)
Expected: PASS across shared, server, and client.

- [ ] **Step 9: Commit**

```bash
git add client/
git commit -m "$(cat <<'EOF'
feat: add login and signup screens with role-aware routing

Both forms validate with the same zod schemas the server uses, imported
from shared/, so the browser and the API cannot disagree about what is
valid.

Failed submissions keep everything the user typed, per requirements
section 13. A pending camp official sees an explanation of what happens
next rather than a bare error.

Admin is deliberately absent from the signup role list: section 4 says
admins are provisioned, not self-registered.

Route guards are convenience, not security — every route is already
enforced server-side by authorize(). They exist so users are not shown a
screen that can only fail.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: End-to-end verification against the acceptance criteria

**Files:**
- Create: `docs/superpowers/plans/2026-08-12-m1-plan1-verification.md`

**Interfaces:**
- Consumes: everything built in Tasks 1–11
- Produces: a written verification record

**Why a task and not a vibe:** the spec says a milestone is done when it is verified against §16, not when the code looks finished. This runs the real system against real Atlas, not the in-memory harness.

- [ ] **Step 1: Run the whole suite and record the count**

Run: `npm test`
Expected: PASS, zero failures. Record the exact test count.

- [ ] **Step 2: Start the real stack**

```bash
npm run seed --workspace server
npm run dev
```

Expected: API on `http://localhost:4000`, client on `http://localhost:5173`, both connected to Atlas.

- [ ] **Step 3: Walk the manual checks**

Confirm each, recording the result:

1. `GET http://localhost:4000/api/health` returns `{"status":"ok"}`.
2. Sign up as an affected person → account created, sign in works. **No OTP step anywhere** (§16, §3.2).
3. Sign up as a camp official → "awaiting administrator approval"; signing in returns that explanation, not a generic failure.
4. Sign in as the seeded admin → approve the official → the official can now sign in.
5. Reload the page while signed in → still signed in (refresh cookie restored the session).
6. Sign out → reload → signed out, and `/admin` redirects to login.
7. Sign in as a donor and request `/api/auth/pending-officials` with their token via curl → **403**, proving the server refuses regardless of what the UI shows.
8. In DevTools → Application → Local Storage: **no token stored**. Cookies show `refresh_token` flagged HttpOnly.
9. Query the `audit_logs` collection in Atlas → entries for `user.signup`, `user.login`, `user.official_approved`; no passwords or hashes in any `before`/`after`.

- [ ] **Step 4: Write the verification record**

Create `docs/superpowers/plans/2026-08-12-m1-plan1-verification.md` with: date, test count, each of the nine checks with PASS/FAIL and evidence, and any defect found with its follow-up task.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs: record Plan 1 verification against acceptance criteria

Milestone work is done when verified against requirements section 16, not
when the code looks finished. These checks ran against real Atlas rather
than the in-memory test harness, covering the acceptance criteria Plan 1 is
responsible for: signup and login with no OTP step, server-side role
enforcement independent of the UI, and an audit trail carrying no secrets.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Plan 1 Self-Review

**Spec coverage.** Plan 1 owns spec §3 (architecture), §3.1 (`shared/`), §3.2 (server structure), §4.2 deviation 4 (`refresh_tokens`), §5.2 (priority derivation), §6 (auth and authorization), §8 (error envelope), and §9 (testing harness). Every one maps to a task above. Aadhaar *storage* (§2.1) is deliberately not here — only the validator is; encryption arrives in Plan 3 where it is first written to a record.

**Deferred to later plans, by design:** `withAudit` route wrapper (Plan 2, once mutating resource routes exist), Socket.IO (Plan 2, when live occupancy first has data), idempotency keys (Plan 3, on the registration endpoint), Aadhaar HMAC and AES (Plan 3).

**Type consistency check.** `toSafeJSON()` returns `assigned_camp_id` as a string or null; the approval test asserts `res.body.user.assigned_camp_id` equals the string camp id — consistent. `signAccessToken` puts `camp_id` in the payload; `authenticate` reads `user.assigned_camp_id` from the database rather than the token, and `requireOwnCamp` compares `req.user.camp_id` — consistent, and deliberately database-sourced so a reassignment takes effect without waiting for the token to expire. `recordAudit` takes `actor_role`; every call site passes it.

**Known constraint to watch in Plan 2:** `authLimiter` allows 20 requests per 15 minutes per IP. If Plan 2's tests push past that, raise the limit under `NODE_ENV === 'test'` rather than removing it.
