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

async function registerVolunteer(aadhaar = '234567897007') {
  const admin = await makeUser('admin');
  const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
  const campId = campRes.body.camp.id;
  const person = await makeUser('affected_person');
  const regRes = await request(app).post('/api/registrations').set(bearer(person)).send({
    camp_id: campId,
    members: [{
      name: 'Meena Devi', age: 34, gender: 'female', aadhaar,
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
  });

  it('refuses a donor', async () => {
    const { memberId } = await registerVolunteer();
    const donor = await makeUser('donor');
    const res = await request(app).post(`/api/volunteers/${memberId}/assign`).set(bearer(donor)).send({ task: 'X', shift: 'Y' });
    expect(res.status).toBe(403);
  });

  it('refuses a camp official from another camp', async () => {
    const { memberId, admin } = await registerVolunteer();
    const otherCampRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody({ name: 'Other Camp' }));
    const official = await makeUser('camp_official', { assigned_camp_id: otherCampRes.body.camp.id });

    const res = await request(app).post(`/api/volunteers/${memberId}/assign`).set(bearer(official)).send({ task: 'X', shift: 'Y' });
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
  });

  it('refuses to complete a duty that was never assigned', async () => {
    const { memberId, admin } = await registerVolunteer();
    const res = await request(app).post(`/api/volunteers/${memberId}/complete`).set(bearer(admin)).send({ hours: 4 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/volunteers', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lists accepted and active volunteers with their beneficiary code', async () => {
    const { memberId, admin } = await registerVolunteer();
    await request(app).post(`/api/volunteers/${memberId}/assign`).set(bearer(admin)).send({ task: 'Food distribution', shift: 'Morning' });

    const res = await request(app).get('/api/volunteers').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.volunteers).toHaveLength(1);
    expect(res.body.volunteers[0].volunteer_task).toBe('Food distribution');
    expect(res.body.volunteers[0].beneficiary_code).toMatch(/^BEN-\d+$/);
  });

  it('omits volunteers whose duty is already completed', async () => {
    const { memberId, admin } = await registerVolunteer();
    await request(app).post(`/api/volunteers/${memberId}/assign`).set(bearer(admin)).send({ task: 'X', shift: 'Y' });
    await request(app).post(`/api/volunteers/${memberId}/complete`).set(bearer(admin)).send({ hours: 2 });

    const res = await request(app).get('/api/volunteers').set(bearer(admin));
    expect(res.body.volunteers).toHaveLength(0);
  });
});
