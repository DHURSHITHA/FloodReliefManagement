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

/** Approval now requires a camp that actually exists, so fixtures need a real one. */
async function makeCamp(admin) {
  const res = await request(app).post('/api/camps').set(bearer(admin)).send({
    name: 'Riverside Community Hall', camp_type: 'community_hall',
    address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
    latitude: 26.2, longitude: 91.7, flood_severity: 'high',
    beneficiary_capacity: 10, volunteer_capacity: 5, duration_days: 14,
    nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
    nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  });
  return res.body.camp.id;
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
    const campId = await makeCamp(admin);

    const res = await request(app)
      .post(`/api/auth/officials/${official._id}/decision`)
      .set(bearer(admin))
      .send({ decision: 'approve', assigned_camp_ids: [campId] });

    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('active');
    expect(res.body.user.assigned_camp_ids).toEqual([campId]);

    const saved = await User.findById(official._id);
    expect(saved.approved_by.toString()).toBe(admin._id.toString());
    expect(saved.approved_at).toBeInstanceOf(Date);
  });

  it('lets an approved official log in, having been refused before', async () => {
    const admin = await makeAdmin();
    const official = await makePendingOfficial();
    const campId = await makeCamp(admin);

    const before = await request(app).post('/api/auth/login').send({ identifier: '9876543212', password });
    expect(before.status).toBe(403);

    await request(app).post(`/api/auth/officials/${official._id}/decision`)
      .set(bearer(admin)).send({ decision: 'approve', assigned_camp_ids: [campId] });

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
    const campId = await makeCamp(admin);
    const res = await request(app).post(`/api/auth/officials/${donor._id}/decision`)
      .set(bearer(admin)).send({ decision: 'approve', assigned_camp_ids: [campId] });
    expect(res.status).toBe(404);
  });

  it('audits the decision with the admin as actor', async () => {
    const admin = await makeAdmin();
    const official = await makePendingOfficial();
    const campId = await makeCamp(admin);
    await request(app).post(`/api/auth/officials/${official._id}/decision`)
      .set(bearer(admin)).send({ decision: 'approve', assigned_camp_ids: [campId] });

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

  it('refuses to approve without a camp, which would strand the account', async () => {
    const admin = await makeAdmin();
    const official = await makePendingOfficial();

    const res = await request(app).post(`/api/auth/officials/${official._id}/decision`)
      .set(bearer(admin)).send({ decision: 'approve' });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('assigned_camp_ids');

    const saved = await User.findById(official._id);
    expect(saved.status).toBe('pending_approval');
  });

  it('refuses to approve against a camp that does not exist', async () => {
    const admin = await makeAdmin();
    const official = await makePendingOfficial();

    const res = await request(app).post(`/api/auth/officials/${official._id}/decision`)
      .set(bearer(admin))
      .send({ decision: 'approve', assigned_camp_ids: [new mongoose.Types.ObjectId().toString()] });

    expect(res.status).toBe(404);
    const saved = await User.findById(official._id);
    expect(saved.status).toBe('pending_approval');
  });

  it('still lets an official be rejected without naming a camp', async () => {
    const admin = await makeAdmin();
    const official = await makePendingOfficial();

    const res = await request(app).post(`/api/auth/officials/${official._id}/decision`)
      .set(bearer(admin)).send({ decision: 'reject' });

    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('rejected');
  });
});

describe('listing every camp official', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('returns pending, active and rejected officials together, newest first', async () => {
    const admin = await makeAdmin();
    const oldest = await makePendingOfficial('9876543212');
    await new Promise((r) => setTimeout(r, 5));
    const campId = await makeCamp(admin);
    await request(app).post(`/api/auth/officials/${oldest._id}/decision`)
      .set(bearer(admin)).send({ decision: 'approve', assigned_camp_ids: [campId] });
    await new Promise((r) => setTimeout(r, 5));
    const newest = await makePendingOfficial('9876543213');

    const res = await request(app).get('/api/auth/officials').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.officials.map((o) => o.id)).toEqual([newest._id.toString(), oldest._id.toString()]);
    expect(res.body.officials[1].status).toBe('active');
    expect(res.body.officials[1].assigned_camp_ids).toEqual([campId]);
  });

  it('refuses the full list to a non-admin', async () => {
    const official = await makePendingOfficial();
    await User.updateOne({ _id: official._id }, { status: 'active' });
    const active = await User.findById(official._id);
    const res = await request(app).get('/api/auth/officials').set(bearer(active));
    expect(res.status).toBe(403);
  });
});

describe('assigning more camps to an active official', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  async function makeActiveOfficial(admin, campId) {
    const official = await makePendingOfficial();
    await request(app).post(`/api/auth/officials/${official._id}/decision`)
      .set(bearer(admin)).send({ decision: 'approve', assigned_camp_ids: [campId] });
    return official;
  }

  it('adds a second camp without dropping the first', async () => {
    const admin = await makeAdmin();
    const campA = await makeCamp(admin);
    const official = await makeActiveOfficial(admin, campA);
    const campB = await makeCamp(admin);

    const res = await request(app).patch(`/api/auth/officials/${official._id}/camps`)
      .set(bearer(admin)).send({ camp_ids: [campB] });

    expect(res.status).toBe(200);
    expect(res.body.user.assigned_camp_ids.sort()).toEqual([campA, campB].sort());
  });

  it('does not duplicate a camp the official already runs', async () => {
    const admin = await makeAdmin();
    const campA = await makeCamp(admin);
    const official = await makeActiveOfficial(admin, campA);

    const res = await request(app).patch(`/api/auth/officials/${official._id}/camps`)
      .set(bearer(admin)).send({ camp_ids: [campA] });

    expect(res.status).toBe(200);
    expect(res.body.user.assigned_camp_ids).toEqual([campA]);
  });

  it('refuses to assign camps to an official still pending approval', async () => {
    const admin = await makeAdmin();
    const campId = await makeCamp(admin);
    const official = await makePendingOfficial();

    const res = await request(app).patch(`/api/auth/officials/${official._id}/camps`)
      .set(bearer(admin)).send({ camp_ids: [campId] });

    expect(res.status).toBe(400);
  });

  it('refuses a camp that does not exist', async () => {
    const admin = await makeAdmin();
    const campA = await makeCamp(admin);
    const official = await makeActiveOfficial(admin, campA);

    const res = await request(app).patch(`/api/auth/officials/${official._id}/camps`)
      .set(bearer(admin)).send({ camp_ids: [new mongoose.Types.ObjectId().toString()] });

    expect(res.status).toBe(404);
  });

  it('refuses a non-admin', async () => {
    const admin = await makeAdmin();
    const campA = await makeCamp(admin);
    const campB = await makeCamp(admin);
    const official = await makeActiveOfficial(admin, campA);

    const res = await request(app).patch(`/api/auth/officials/${official._id}/camps`)
      .set(bearer(official)).send({ camp_ids: [campB] });

    expect(res.status).toBe(403);
  });

  it('validates that at least one camp id is given', async () => {
    const admin = await makeAdmin();
    const campA = await makeCamp(admin);
    const official = await makeActiveOfficial(admin, campA);

    const res = await request(app).patch(`/api/auth/officials/${official._id}/camps`)
      .set(bearer(admin)).send({ camp_ids: [] });

    expect(res.status).toBe(400);
  });

  it('audits the assignment with the before and after camp lists', async () => {
    const admin = await makeAdmin();
    const campA = await makeCamp(admin);
    const official = await makeActiveOfficial(admin, campA);
    const campB = await makeCamp(admin);

    await request(app).patch(`/api/auth/officials/${official._id}/camps`)
      .set(bearer(admin)).send({ camp_ids: [campB] });

    const entry = await AuditLog.findOne({ action: 'user.official_camps_assigned' });
    expect(entry.actor_id.toString()).toBe(admin._id.toString());
    expect(entry.before).toEqual({ assigned_camp_ids: [campA] });
    expect(entry.after.assigned_camp_ids.sort()).toEqual([campA, campB].sort());
  });
});
