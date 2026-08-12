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
