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
    const official = await makeUser('camp_official', { assigned_camp_ids: [campId] });
    const res = await request(app).get(`/camps/${campId}`).set('Authorization', `Bearer ${signAccessToken(official)}`);
    expect(res.status).toBe(200);
  });

  it('refuses an official acting on someone else camp', async () => {
    const official = await makeUser('camp_official', { assigned_camp_ids: [new mongoose.Types.ObjectId()] });
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
