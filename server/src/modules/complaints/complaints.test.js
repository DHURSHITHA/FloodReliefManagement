import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { Notification } from '../notifications/notification.model.js';
import { AuditLog } from '../audit/audit.model.js';
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

async function createCamp(admin, over = {}) {
  const res = await request(app).post('/api/camps').set(bearer(admin)).send(campBody(over));
  return res.body.camp.id;
}

const complaintBody = (campId, over = {}) => ({
  camp_id: campId, category: 'water', description: 'The water point has been dry since morning.', ...over,
});

describe('complaints (requirements 6.10)', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an affected person raise one and issues a CMP- code', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person = await makeUser('affected_person');

    const res = await request(app).post('/api/complaints').set(bearer(person)).send(complaintBody(campId));
    expect(res.status).toBe(201);
    expect(res.body.complaint.complaint_code).toMatch(/^CMP-\d+$/);
    expect(res.body.complaint.status).toBe('open');
  });

  it('notifies only the officials assigned to that camp', async () => {
    const admin = await makeUser('admin');
    const campA = await createCamp(admin, { name: 'Riverside Community Hall' });
    const campB = await createCamp(admin, { name: 'Hilltop School' });
    const atCampA = await makeUser('camp_official', { assigned_camp_ids: [campA] });
    const atCampB = await makeUser('camp_official', { assigned_camp_ids: [campB] });
    const person = await makeUser('affected_person');

    await request(app).post('/api/complaints').set(bearer(person)).send(complaintBody(campA));

    expect(await Notification.countDocuments({ user_id: atCampA._id, type: 'complaint' })).toBe(1);
    expect(await Notification.countDocuments({ user_id: atCampB._id })).toBe(0);
  });

  it('shows an official the complaints at their camp and hides other camps', async () => {
    const admin = await makeUser('admin');
    const campA = await createCamp(admin, { name: 'Riverside Community Hall' });
    const campB = await createCamp(admin, { name: 'Hilltop School' });
    const person = await makeUser('affected_person');
    await request(app).post('/api/complaints').set(bearer(person)).send(complaintBody(campA));
    await request(app).post('/api/complaints').set(bearer(person)).send(complaintBody(campB, { category: 'food' }));

    const official = await makeUser('camp_official', { assigned_camp_ids: [campA] });
    const res = await request(app).get('/api/complaints').set(bearer(official));

    expect(res.status).toBe(200);
    expect(res.body.complaints).toHaveLength(1);
    expect(res.body.complaints[0].category).toBe('water');
  });

  it('returns the reporter their own complaints', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person = await makeUser('affected_person');
    const other = await makeUser('affected_person');
    await request(app).post('/api/complaints').set(bearer(person)).send(complaintBody(campId));
    await request(app).post('/api/complaints').set(bearer(other)).send(complaintBody(campId, { category: 'food' }));

    const res = await request(app).get('/api/complaints/mine').set(bearer(person));
    expect(res.body.complaints).toHaveLength(1);
    expect(res.body.complaints[0].category).toBe('water');
  });

  it('lets an official review it, and tells the reporter', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person = await makeUser('affected_person');
    const official = await makeUser('camp_official', { assigned_camp_ids: [campId] });
    const created = await request(app).post('/api/complaints').set(bearer(person)).send(complaintBody(campId));

    const res = await request(app).patch(`/api/complaints/${created.body.complaint.id}`)
      .set(bearer(official)).send({ status: 'under_review' });

    expect(res.status).toBe(200);
    expect(res.body.complaint.status).toBe('under_review');
    expect(res.body.complaint.assigned_to).toBe(official._id.toString());
    expect(res.body.complaint.resolved_at).toBeNull();

    const told = await Notification.findOne({ user_id: person._id, type: 'complaint_update' });
    expect(told.message).toMatch(/under review/i);
  });

  it('will not close one without saying what was done', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person = await makeUser('affected_person');
    const official = await makeUser('camp_official', { assigned_camp_ids: [campId] });
    const created = await request(app).post('/api/complaints').set(bearer(person)).send(complaintBody(campId));

    const res = await request(app).patch(`/api/complaints/${created.body.complaint.id}`)
      .set(bearer(official)).send({ status: 'resolved' });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('resolution');
  });

  it('stamps resolved_at when it is closed with a resolution', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person = await makeUser('affected_person');
    const official = await makeUser('camp_official', { assigned_camp_ids: [campId] });
    const created = await request(app).post('/api/complaints').set(bearer(person)).send(complaintBody(campId));

    const res = await request(app).patch(`/api/complaints/${created.body.complaint.id}`)
      .set(bearer(official)).send({ status: 'resolved', resolution: 'Tanker refilled at 14:00.' });

    expect(res.body.complaint.resolved_at).not.toBeNull();
    expect(res.body.complaint.resolution).toBe('Tanker refilled at 14:00.');
  });

  it('refuses an official reviewing another camp\'s complaint', async () => {
    const admin = await makeUser('admin');
    const campA = await createCamp(admin, { name: 'Riverside Community Hall' });
    const campB = await createCamp(admin, { name: 'Hilltop School' });
    const person = await makeUser('affected_person');
    const created = await request(app).post('/api/complaints').set(bearer(person)).send(complaintBody(campA));
    const elsewhere = await makeUser('camp_official', { assigned_camp_ids: [campB] });

    const res = await request(app).patch(`/api/complaints/${created.body.complaint.id}`)
      .set(bearer(elsewhere)).send({ status: 'in_progress' });
    expect(res.status).toBe(403);
  });

  it('refuses a donor entirely', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const donor = await makeUser('donor');

    expect((await request(app).post('/api/complaints').set(bearer(donor)).send(complaintBody(campId))).status).toBe(403);
    expect((await request(app).get('/api/complaints').set(bearer(donor))).status).toBe(403);
  });

  it('audits both raising and reviewing', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person = await makeUser('affected_person');
    const official = await makeUser('camp_official', { assigned_camp_ids: [campId] });
    const created = await request(app).post('/api/complaints').set(bearer(person)).send(complaintBody(campId));
    await request(app).patch(`/api/complaints/${created.body.complaint.id}`)
      .set(bearer(official)).send({ status: 'in_progress' });

    expect(await AuditLog.countDocuments({ action: 'complaint.create' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'complaint.review' })).toBe(1);
  });
});
