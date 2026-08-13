import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role) {
  return User.create({
    name: 'Test', mobile: String(9200000000 + Math.floor(Math.random() * 799999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active',
  });
}
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

const campBody = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7,
  flood_severity: 'high',
  beneficiary_capacity: 400, volunteer_capacity: 30, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

describe('POST /api/camps', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin create a camp', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    expect(res.status).toBe(201);
    expect(res.body.camp).toMatchObject({ name: 'Riverside Community Hall', status: 'open' });
  });

  it('refuses a camp official', async () => {
    const official = await makeUser('camp_official');
    const res = await request(app).post('/api/camps').set(bearer(official)).send(campBody());
    expect(res.status).toBe(403);
  });

  it('validates missing mandatory fields', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).post('/api/camps').set(bearer(admin)).send(campBody({ beneficiary_capacity: undefined }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/camps — area linkage', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('auto-creates an affected area from the camp’s own location when none is chosen', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    expect(res.status).toBe(201);
    expect(res.body.camp.linked_area_id).toMatch(/^[0-9a-fA-F]{24}$/);

    const areas = await request(app).get('/api/areas').set(bearer(admin));
    expect(areas.body.areas).toHaveLength(1);
    expect(areas.body.areas[0]).toMatchObject({ name: 'Ward 12', district: 'North District', severity: 'high', has_camp: true });
  });

  it('links to an existing area instead of creating a second one when linked_area_id is given', async () => {
    const admin = await makeUser('admin');
    const areaRes = await request(app).post('/api/areas').set(bearer(admin)).send({
      name: 'Ward 12', district: 'North District', state: 'Assam',
      address: 'Near river embankment', latitude: 26.2, longitude: 91.7, severity: 'high',
    });

    const res = await request(app).post('/api/camps').set(bearer(admin)).send(campBody({ linked_area_id: areaRes.body.area.id }));
    expect(res.status).toBe(201);
    expect(res.body.camp.linked_area_id).toBe(areaRes.body.area.id);

    const areas = await request(app).get('/api/areas').set(bearer(admin));
    expect(areas.body.areas).toHaveLength(1); // no second area was created
  });

  it('rejects a linked_area_id that does not exist', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).post('/api/camps').set(bearer(admin)).send(campBody({ linked_area_id: '000000000000000000000000' }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/camps', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lists camps for any authenticated role, including affected_person', async () => {
    const admin = await makeUser('admin');
    await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const person = await makeUser('affected_person');
    const res = await request(app).get('/api/camps').set(bearer(person));
    expect(res.status).toBe(200);
    expect(res.body.camps).toHaveLength(1);
  });

  it('filters by status', async () => {
    const admin = await makeUser('admin');
    await request(app).post('/api/camps').set(bearer(admin)).send(campBody({ name: 'Camp A' }));
    const res = await request(app).get('/api/camps?status=open').set(bearer(admin));
    expect(res.body.camps).toHaveLength(1);
    const none = await request(app).get('/api/camps?status=closed').set(bearer(admin));
    expect(none.body.camps).toHaveLength(0);
  });
});

describe('GET /api/camps/:id', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('returns one camp', async () => {
    const admin = await makeUser('admin');
    const created = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const res = await request(app).get(`/api/camps/${created.body.camp.id}`).set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.camp.id).toBe(created.body.camp.id);
  });

  it('404s for an unknown id', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).get('/api/camps/000000000000000000000000').set(bearer(admin));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/camps/:id', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin close a camp', async () => {
    const admin = await makeUser('admin');
    const created = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const res = await request(app)
      .patch(`/api/camps/${created.body.camp.id}`)
      .set(bearer(admin))
      .send({ admin_override: 'closed' });
    expect(res.status).toBe(200);
    expect(res.body.camp.status).toBe('closed');
  });

  it('refuses a donor', async () => {
    const admin = await makeUser('admin');
    const created = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const donor = await makeUser('donor');
    const res = await request(app)
      .patch(`/api/camps/${created.body.camp.id}`)
      .set(bearer(donor))
      .send({ admin_override: 'closed' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/camps/nearest', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('returns nearby camps with remaining capacity', async () => {
    const admin = await makeUser('admin');
    await request(app).post('/api/camps').set(bearer(admin)).send(campBody({ name: 'Near', latitude: 26.2, longitude: 91.7 }));
    const res = await request(app).get('/api/camps/nearest?latitude=26.2&longitude=91.7').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.camps[0].name).toBe('Near');
  });

  it('validates that latitude/longitude are provided', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).get('/api/camps/nearest').set(bearer(admin));
    expect(res.status).toBe(400);
  });
});
