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
    { name: 'Meena Devi', age: 34, gender: 'female', aadhaar: '234567890218', mobile: '9876543210', address: '12 River Road' },
    { name: 'Raju', age: 8, gender: 'male', aadhaar: '234567890225', relation_to_applicant: 'child' },
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
