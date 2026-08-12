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
    name: 'Meena Devi', age: 34, gender: 'female', aadhaar: '234567890202',
    mobile: '9876543210', address: '12 River Road',
  }],
  ...over,
});

async function createCamp(admin, over = {}) {
  const res = await request(app).post('/api/camps').set(bearer(admin)).send(campBody(over));
  return res.body.camp.id;
}

/** Registers one family at `campId` and returns its BEN- code. */
async function registerAt(campId, aadhaar, name) {
  const person = await makeUser('affected_person');
  const res = await request(app).post('/api/registrations').set(bearer(person)).send(
    registrationBody(campId, { members: [{ name, age: 34, gender: 'female', aadhaar, mobile: '9876543210', address: '12 River Road' }] }),
  );
  return res.body.beneficiary.beneficiary_code;
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

  it('lets an official assigned to the camp search it by code', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person = await makeUser('affected_person');
    const created = await request(app).post('/api/registrations').set(bearer(person)).send(registrationBody(campId));
    const code = created.body.beneficiary.beneficiary_code;
    const official = await makeUser('camp_official', { assigned_camp_ids: [campId] });

    const res = await request(app).get(`/api/registrations?search=${code}`).set(bearer(official));
    expect(res.status).toBe(200);
    expect(res.body.registrations).toHaveLength(1);
    expect(res.body.registrations[0].beneficiary.beneficiary_code).toBe(code);
  });

  it('tells an official with no assigned camp why the search finds nothing', async () => {
    const admin = await makeUser('admin');
    const campId = await createCamp(admin);
    const person = await makeUser('affected_person');
    const created = await request(app).post('/api/registrations').set(bearer(person)).send(registrationBody(campId));
    const code = created.body.beneficiary.beneficiary_code;
    const stranded = await makeUser('camp_official'); // approved, but never assigned a camp

    const search = await request(app).get(`/api/registrations?search=${code}`).set(bearer(stranded));
    expect(search.status).toBe(403);
    expect(search.body.error.message).toMatch(/No camp is assigned/i);

    // The Distribute screen's lookup must fail the same legible way.
    const byCode = await request(app).get(`/api/registrations/${code}`).set(bearer(stranded));
    expect(byCode.status).toBe(403);
    expect(byCode.body.error.message).toMatch(/No camp is assigned/i);
  });
});

describe('the camp bar: searching across several assigned camps', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  async function twoCamps() {
    const admin = await makeUser('admin');
    const campA = await createCamp(admin, { name: 'Riverside Community Hall' });
    const campB = await createCamp(admin, { name: 'Hilltop School' });
    const codeA = await registerAt(campA, '234567890202', 'Meena Devi');
    const codeB = await registerAt(campB, '345678901238', 'Anitha Rao');
    return { admin, campA, campB, codeA, codeB };
  }

  it('spans every assigned camp when no camp is selected', async () => {
    const { campA, campB, codeA, codeB } = await twoCamps();
    const official = await makeUser('camp_official', { assigned_camp_ids: [campA, campB] });

    const a = await request(app).get(`/api/registrations?search=${codeA}`).set(bearer(official));
    const b = await request(app).get(`/api/registrations?search=${codeB}`).set(bearer(official));
    expect(a.body.registrations).toHaveLength(1);
    expect(b.body.registrations).toHaveLength(1);
  });

  it('narrows to the selected camp, hiding the other one', async () => {
    const { campA, campB, codeA, codeB } = await twoCamps();
    const official = await makeUser('camp_official', { assigned_camp_ids: [campA, campB] });

    const hit = await request(app).get(`/api/registrations?search=${codeA}&camp_id=${campA}`).set(bearer(official));
    expect(hit.body.registrations).toHaveLength(1);

    const miss = await request(app).get(`/api/registrations?search=${codeB}&camp_id=${campA}`).set(bearer(official));
    expect(miss.status).toBe(200);
    expect(miss.body.registrations).toHaveLength(0);
  });

  it('refuses a camp the official is not assigned to', async () => {
    const { campA, campB, codeB } = await twoCamps();
    const official = await makeUser('camp_official', { assigned_camp_ids: [campA] });

    const res = await request(app).get(`/api/registrations?search=${codeB}&camp_id=${campB}`).set(bearer(official));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/not assigned to that camp/i);
  });

  it('still refuses a registration at an unassigned camp on the by-code lookup', async () => {
    const { campA, codeB } = await twoCamps();
    const official = await makeUser('camp_official', { assigned_camp_ids: [campA] });

    const res = await request(app).get(`/api/registrations/${codeB}`).set(bearer(official));
    expect(res.status).toBe(403);
  });

  it('lets an admin narrow to one camp too', async () => {
    const { admin, campA, codeB } = await twoCamps();
    const res = await request(app).get(`/api/registrations?search=${codeB}&camp_id=${campA}`).set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.registrations).toHaveLength(0);
  });
});
