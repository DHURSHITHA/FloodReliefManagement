import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { raiseSos, listMySos, listSos, transitionSos, getSosDashboardCounts } from './sos.service.js';
import { createCamp } from '../camps/camps.service.js';
import { User, hashPassword } from '../auth/user.model.js';
import { Notification } from '../notifications/notification.model.js';
import { createApp } from '../../app.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9200000000 + Math.floor(Math.random() * 99999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active', ...over,
  });
}

const campInput = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7, flood_severity: 'high',
  beneficiary_capacity: 10, volunteer_capacity: 5, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

async function makeCamp(admin, over = {}) {
  return createCamp(campInput(over), { actorId: admin._id, actorRole: 'admin', ip: '127.0.0.1' });
}

describe('sos.service (requirements §6.11)', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('routes a medical emergency to the camp hospital contact', async () => {
    const admin = await makeUser('admin');
    const camp = await makeCamp(admin);
    const person = await makeUser('affected_person');

    const sos = await raiseSos(
      { camp_id: camp._id, category: 'medical', urgency: 'critical', description: 'Chest pains, needs help now.', location: 'Tent 4' },
      { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' }
    );

    expect(sos.sos_code).toMatch(/^SOS-\d+$/);
    expect(sos.routed_to_type).toBe('hospital');
    expect(sos.routed_to_name).toBe('District Hospital');
    expect(sos.routed_to_contact).toBe('0484-2000000');
    expect(sos.status).toBe('open');
    expect(sos.timeline).toHaveLength(1);
    expect(sos.timeline[0].status).toBe('open');
  });

  it('routes a security emergency to the camp police contact', async () => {
    const admin = await makeUser('admin');
    const camp = await makeCamp(admin);
    const person = await makeUser('affected_person');

    const sos = await raiseSos(
      { camp_id: camp._id, category: 'security', urgency: 'high', description: 'A fight has broken out near the gate.', location: 'Main gate' },
      { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' }
    );

    expect(sos.routed_to_type).toBe('police');
    expect(sos.routed_to_name).toBe('Ward 12 Police Station');
    expect(sos.routed_to_contact).toBe('0484-2100000');
  });

  it('routes every other category to the camp administration', async () => {
    const admin = await makeUser('admin');
    const camp = await makeCamp(admin);
    const person = await makeUser('affected_person');

    const sos = await raiseSos(
      { camp_id: camp._id, category: 'food_shortage', urgency: 'medium', description: 'Ran out of rice this morning.', location: 'Food line' },
      { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' }
    );

    expect(sos.routed_to_type).toBe('camp_admin');
  });

  it('copies the routed contact rather than referencing it live', async () => {
    const admin = await makeUser('admin');
    const camp = await makeCamp(admin);
    const person = await makeUser('affected_person');

    const sos = await raiseSos(
      { camp_id: camp._id, category: 'medical', urgency: 'high', description: 'Someone collapsed near the well.', location: 'Well' },
      { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' }
    );

    // Edit the camp's hospital contact after the SOS was raised.
    camp.nearest_hospital_contact = '0000-0000000';
    await camp.save();

    const stored = (await listMySos(person._id)).find((s) => s._id.toString() === sos._id.toString());
    expect(stored.routed_to_contact).toBe('0484-2000000');
  });

  it('notifies admins and the officials assigned to that camp, not officials elsewhere', async () => {
    const admin = await makeUser('admin');
    const campA = await makeCamp(admin, { name: 'Riverside Community Hall' });
    const campB = await makeCamp(admin, { name: 'Hilltop School' });
    const atCampA = await makeUser('camp_official', { assigned_camp_ids: [campA._id] });
    const atCampB = await makeUser('camp_official', { assigned_camp_ids: [campB._id] });
    const person = await makeUser('affected_person');

    await raiseSos(
      { camp_id: campA._id, category: 'medical', urgency: 'critical', description: 'Chest pains, needs help now.', location: 'Tent 4' },
      { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' }
    );

    expect(await Notification.countDocuments({ user_id: admin._id, type: 'sos' })).toBe(1);
    expect(await Notification.countDocuments({ user_id: atCampA._id, type: 'sos' })).toBe(1);
    expect(await Notification.countDocuments({ user_id: atCampB._id })).toBe(0);
  });

  it('shows an official only the SOS requests at their camp', async () => {
    const admin = await makeUser('admin');
    const campA = await makeCamp(admin, { name: 'Riverside Community Hall' });
    const campB = await makeCamp(admin, { name: 'Hilltop School' });
    const person = await makeUser('affected_person');

    await raiseSos(
      { camp_id: campA._id, category: 'medical', urgency: 'high', description: 'Needs medical attention now.', location: 'Tent 4' },
      { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' }
    );
    await raiseSos(
      { camp_id: campB._id, category: 'medical', urgency: 'high', description: 'Needs medical attention now.', location: 'Tent 2' },
      { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' }
    );

    const results = await listSos({ actorRole: 'camp_official', actorCampIds: [campA._id.toString()] });
    expect(results).toHaveLength(1);
    expect(results[0].camp_id.toString()).toBe(campA._id.toString());
  });

  it('sorts open requests by urgency, most urgent first', async () => {
    const admin = await makeUser('admin');
    const camp = await makeCamp(admin);
    const person = await makeUser('affected_person');

    await raiseSos({ camp_id: camp._id, category: 'other', urgency: 'low', description: 'Minor issue with the tarpaulin.', location: 'Tent 7' }, { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' });
    await raiseSos({ camp_id: camp._id, category: 'medical', urgency: 'critical', description: 'Chest pains, needs help now.', location: 'Tent 4' }, { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' });
    await raiseSos({ camp_id: camp._id, category: 'food_shortage', urgency: 'medium', description: 'Ran out of rice this morning.', location: 'Food line' }, { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' });

    const results = await listSos({ actorRole: 'admin', actorCampIds: [] });
    expect(results.map((r) => r.urgency)).toEqual(['critical', 'medium', 'low']);
  });

  it('rejects resolving without a note, requires one to close, appends the timeline, and notifies the reporter', async () => {
    const admin = await makeUser('admin');
    const camp = await makeCamp(admin);
    const person = await makeUser('affected_person');
    const sos = await raiseSos(
      { camp_id: camp._id, category: 'medical', urgency: 'high', description: 'Needs medical attention now.', location: 'Tent 4' },
      { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' }
    );

    await transitionSos(sos._id, { status: 'acknowledged' }, { actorId: admin._id, actorRole: 'admin', actorCampIds: [], ip: '127.0.0.1' });
    const resolved = await transitionSos(
      sos._id,
      { status: 'resolved', note: 'Taken to the medical tent, stable.' },
      { actorId: admin._id, actorRole: 'admin', actorCampIds: [], ip: '127.0.0.1' }
    );

    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution).toBe('Taken to the medical tent, stable.');
    expect(resolved.resolved_at).not.toBeNull();
    expect(resolved.timeline).toHaveLength(3); // open, acknowledged, resolved
    expect(await Notification.countDocuments({ user_id: person._id, type: 'sos_update' })).toBe(2);
  });

  it('refuses an official acting on a camp they are not assigned to', async () => {
    const admin = await makeUser('admin');
    const campA = await makeCamp(admin, { name: 'Riverside Community Hall' });
    const campB = await makeCamp(admin, { name: 'Hilltop School' });
    const person = await makeUser('affected_person');
    const outsider = await makeUser('camp_official', { assigned_camp_ids: [campB._id] });

    const sos = await raiseSos(
      { camp_id: campA._id, category: 'medical', urgency: 'high', description: 'Needs medical attention now.', location: 'Tent 4' },
      { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' }
    );

    await expect(
      transitionSos(sos._id, { status: 'acknowledged' }, { actorId: outsider._id, actorRole: 'camp_official', actorCampIds: [campB._id.toString()], ip: '127.0.0.1' })
    ).rejects.toThrow(/not assigned/i);
  });

  it('computes Emergency dashboard counts, excluding closed requests from "open"', async () => {
    const admin = await makeUser('admin');
    const camp = await makeCamp(admin);
    const person = await makeUser('affected_person');

    const medical = await raiseSos({ camp_id: camp._id, category: 'medical', urgency: 'critical', description: 'Chest pains, needs help now.', location: 'Tent 4' }, { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' });
    await raiseSos({ camp_id: camp._id, category: 'security', urgency: 'high', description: 'A fight has broken out near the gate.', location: 'Main gate' }, { actorId: person._id, actorRole: 'affected_person', ip: '127.0.0.1' });
    await transitionSos(medical._id, { status: 'resolved', note: 'Handled.' }, { actorId: admin._id, actorRole: 'admin', actorCampIds: [], ip: '127.0.0.1' });

    const counts = await getSosDashboardCounts();
    expect(counts).toEqual({ open: 1, medical: 0, security: 1, resolved: 1 });
  });
});

const app = createApp();
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

describe('SOS API routes', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an affected person raise one and issues an SOS- code', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campInput());
    const person = await makeUser('affected_person');

    const res = await request(app).post('/api/sos').set(bearer(person)).send({
      camp_id: campRes.body.camp.id, category: 'medical', urgency: 'critical',
      description: 'Chest pains, needs help now.', location: 'Tent 4',
    });

    expect(res.status).toBe(201);
    expect(res.body.sos.sos_code).toMatch(/^SOS-\d+$/);
    expect(res.body.sos.routed_to_name).toBe('District Hospital');
  });

  it('refuses a donor', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campInput());
    const donor = await makeUser('donor');

    const res = await request(app).post('/api/sos').set(bearer(donor)).send({
      camp_id: campRes.body.camp.id, category: 'medical', urgency: 'high',
      description: 'Chest pains, needs help now.', location: 'Tent 4',
    });
    expect(res.status).toBe(403);
  });

  it('refuses an unauthenticated request', async () => {
    const res = await request(app).get('/api/sos/mine');
    expect(res.status).toBe(401);
  });

  it('lets a camp official narrow by camp and status query params', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campInput());
    const official = await makeUser('camp_official', { assigned_camp_ids: [campRes.body.camp.id] });
    const person = await makeUser('affected_person');
    await request(app).post('/api/sos').set(bearer(person)).send({
      camp_id: campRes.body.camp.id, category: 'medical', urgency: 'high',
      description: 'Chest pains, needs help now.', location: 'Tent 4',
    });

    const res = await request(app)
      .get(`/api/sos?camp_id=${campRes.body.camp.id}&status=open`)
      .set(bearer(official));
    expect(res.status).toBe(200);
    expect(res.body.sos_requests).toHaveLength(1);
  });

  it('rejects a PATCH to resolved with no note', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campInput());
    const person = await makeUser('affected_person');
    const createRes = await request(app).post('/api/sos').set(bearer(person)).send({
      camp_id: campRes.body.camp.id, category: 'medical', urgency: 'high',
      description: 'Chest pains, needs help now.', location: 'Tent 4',
    });

    const res = await request(app)
      .patch(`/api/sos/${createRes.body.sos.id}`)
      .set(bearer(admin))
      .send({ status: 'resolved' });
    expect(res.status).toBe(400);
  });

  it('accepts a PATCH to resolved with a note', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campInput());
    const person = await makeUser('affected_person');
    const createRes = await request(app).post('/api/sos').set(bearer(person)).send({
      camp_id: campRes.body.camp.id, category: 'medical', urgency: 'high',
      description: 'Chest pains, needs help now.', location: 'Tent 4',
    });

    const res = await request(app)
      .patch(`/api/sos/${createRes.body.sos.id}`)
      .set(bearer(admin))
      .send({ status: 'resolved', note: 'Taken to the medical tent, stable.' });
    expect(res.status).toBe(200);
    expect(res.body.sos.status).toBe('resolved');
  });
});
