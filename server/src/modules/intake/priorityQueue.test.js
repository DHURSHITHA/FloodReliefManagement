import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9500000000 + Math.floor(Math.random() * 499999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active', ...over,
  });
}
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

const campBody = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7, flood_severity: 'high',
  beneficiary_capacity: 20, volunteer_capacity: 5, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

/** One household holding one of every priority band, plus an untagged adult. */
const MIXED_FAMILY = [
  { name: 'Untagged Adult', age: 34, gender: 'male', aadhaar: '234567890218', mobile: '9876543210', address: '12 River Road' },
  { name: 'Young Child', age: 8, gender: 'male', aadhaar: '234567890225', relation_to_applicant: 'child' },
  { name: 'Expecting Mother', age: 28, gender: 'female', aadhaar: '345678901238', is_pregnant: true, relation_to_applicant: 'spouse' },
  { name: 'Grandfather', age: 71, gender: 'male', aadhaar: '456789012341', relation_to_applicant: 'parent' },
  { name: 'Disabled Cousin', age: 40, gender: 'male', aadhaar: '567890123458', has_disability: true, relation_to_applicant: 'other' },
];

async function seedCamp() {
  const admin = await makeUser('admin');
  const campId = (await request(app).post('/api/camps').set(bearer(admin)).send(campBody())).body.camp.id;
  const person = await makeUser('affected_person');
  const reg = await request(app).post('/api/registrations').set(bearer(person))
    .send({ camp_id: campId, members: MIXED_FAMILY });
  return { admin, campId, beneficiary: reg.body.beneficiary, members: reg.body.members };
}

async function checkIn(admin, beneficiaryId, memberId) {
  return request(app).post(`/api/registrations/${beneficiaryId}/members/${memberId}/checkin`).set(bearer(admin));
}

describe('GET /api/registrations/priority', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('serves pregnant first, then senior, then child', async () => {
    const { admin, beneficiary, members } = await seedCamp();
    for (const m of members) await checkIn(admin, beneficiary.id, m.id);

    const res = await request(app).get('/api/registrations/priority').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.members.map((m) => m.name))
      .toEqual(['Expecting Mother', 'Grandfather', 'Young Child', 'Disabled Cousin']);
  });

  it('leaves out the untagged, who have no claim to jump the queue', async () => {
    const { admin, beneficiary, members } = await seedCamp();
    for (const m of members) await checkIn(admin, beneficiary.id, m.id);

    const res = await request(app).get('/api/registrations/priority').set(bearer(admin));
    expect(res.body.members.map((m) => m.name)).not.toContain('Untagged Adult');
  });

  it('leaves out anyone who has not checked in yet', async () => {
    const { admin, beneficiary, members } = await seedCamp();
    const pregnant = members.find((m) => m.name === 'Expecting Mother');
    await checkIn(admin, beneficiary.id, pregnant.id);

    const res = await request(app).get('/api/registrations/priority').set(bearer(admin));
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].name).toBe('Expecting Mother');
  });

  it('carries the beneficiary code, so the desk can distribute straight from the queue', async () => {
    const { admin, beneficiary, members } = await seedCamp();
    await checkIn(admin, beneficiary.id, members.find((m) => m.name === 'Grandfather').id);

    const res = await request(app).get('/api/registrations/priority').set(bearer(admin));
    expect(res.body.members[0].beneficiary_code).toBe(beneficiary.beneficiary_code);
    expect(res.body.members[0].beneficiary_id).toBe(beneficiary.id);
  });

  it('shows an official only their own camp', async () => {
    const { admin, campId, beneficiary, members } = await seedCamp();
    await checkIn(admin, beneficiary.id, members[2].id);

    const otherCamp = (await request(app).post('/api/camps').set(bearer(admin))
      .send(campBody({ name: 'Hilltop School' }))).body.camp.id;
    const elsewhere = await makeUser('camp_official', { assigned_camp_ids: [otherCamp] });
    const here = await makeUser('camp_official', { assigned_camp_ids: [campId] });

    expect((await request(app).get('/api/registrations/priority').set(bearer(elsewhere))).body.members).toHaveLength(0);
    expect((await request(app).get('/api/registrations/priority').set(bearer(here))).body.members).toHaveLength(1);
  });

  it('never exposes the Aadhaar number', async () => {
    const { admin, beneficiary, members } = await seedCamp();
    for (const m of members) await checkIn(admin, beneficiary.id, m.id);

    const res = await request(app).get('/api/registrations/priority').set(bearer(admin));
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/aadhaar_hash|aadhaar_enc/);
    expect(raw).not.toMatch(/\b\d{12}\b/);
  });

  it('refuses a donor', async () => {
    const donor = await makeUser('donor');
    expect((await request(app).get('/api/registrations/priority').set(bearer(donor))).status).toBe(403);
  });
});
