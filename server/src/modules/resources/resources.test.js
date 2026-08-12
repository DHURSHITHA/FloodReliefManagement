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
  beneficiary_capacity: 400, volunteer_capacity: 30, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

async function setup() {
  const admin = await makeUser('admin');
  const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
  return { admin, campId: campRes.body.camp.id };
}

describe('POST /api/resources', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin create a resource item', async () => {
    const { admin } = await setup();
    const res = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    expect(res.status).toBe(201);
    expect(res.body.item.name).toBe('Rice');
  });

  it('refuses a donor', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).post('/api/resources').set(bearer(donor)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/resources', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lists resource items for any authenticated role', async () => {
    const { admin } = await setup();
    await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const official = await makeUser('camp_official');
    const res = await request(app).get('/api/resources').set(bearer(official));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('POST /api/inventory', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin stock a camp with an item', async () => {
    const { admin, campId } = await setup();
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const res = await request(app)
      .post('/api/inventory').set(bearer(admin))
      .send({ camp_id: campId, item_id: itemRes.body.item.id, remaining_qty: 500, reorder_threshold: 50 });
    expect(res.status).toBe(201);
    expect(res.body.inventory.remaining_qty).toBe(500);
  });
});

describe('GET /api/inventory', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('filters by camp and flags low stock', async () => {
    const { admin, campId } = await setup();
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    await request(app).post('/api/inventory').set(bearer(admin))
      .send({ camp_id: campId, item_id: itemRes.body.item.id, remaining_qty: 20, reorder_threshold: 50 });

    const res = await request(app).get(`/api/inventory?camp_id=${campId}`).set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.inventory).toHaveLength(1);
    expect(res.body.inventory[0].is_low_stock).toBe(true);
  });
});

describe('PATCH /api/inventory/:id', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin adjust remaining_qty and emits inventory:changed', async () => {
    const { admin, campId } = await setup();
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const invRes = await request(app).post('/api/inventory').set(bearer(admin))
      .send({ camp_id: campId, item_id: itemRes.body.item.id, remaining_qty: 500, reorder_threshold: 50 });

    const res = await request(app)
      .patch(`/api/inventory/${invRes.body.inventory.id}`).set(bearer(admin))
      .send({ remaining_qty: 300 });
    expect(res.status).toBe(200);
    expect(res.body.inventory.remaining_qty).toBe(300);
  });
});
