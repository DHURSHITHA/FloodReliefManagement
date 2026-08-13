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
  beneficiary_capacity: 400, volunteer_capacity: 30, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

async function setup() {
  const admin = await makeUser('admin');
  const campA = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
  const campB = await request(app).post('/api/camps').set(bearer(admin)).send(campBody({ name: 'Hilltop School' }));
  const item = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
  return { admin, campAId: campA.body.camp.id, campBId: campB.body.camp.id, itemId: item.body.item.id };
}

describe('POST /api/distribution-rules — per-camp rules (requirements §6.9)', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin create a global rule for an item', async () => {
    const { admin, itemId } = await setup();
    const res = await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, mode: 'fixed', period: 'daily', fixed_qty: 5 });
    expect(res.status).toBe(201);
    expect(res.body.rule.camp_id).toBeNull();
  });

  it('lets an admin give the same item a different rule at a specific camp', async () => {
    const { admin, campAId, itemId } = await setup();
    const res = await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, camp_id: campAId, mode: 'fixed', period: 'daily', fixed_qty: 9 });
    expect(res.status).toBe(201);
    expect(res.body.rule.camp_id).toBe(campAId);
  });

  it('lets two different camps each have their own active rule for the same item', async () => {
    const { admin, campAId, campBId, itemId } = await setup();
    const a = await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, camp_id: campAId, mode: 'fixed', period: 'daily', fixed_qty: 9 });
    const b = await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, camp_id: campBId, mode: 'fixed', period: 'daily', fixed_qty: 3 });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it('refuses a second active rule for the same camp and item', async () => {
    const { admin, campAId, itemId } = await setup();
    await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, camp_id: campAId, mode: 'fixed', period: 'daily', fixed_qty: 9 });
    const res = await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, camp_id: campAId, mode: 'fixed', period: 'daily', fixed_qty: 12 });
    expect(res.status).toBe(409);
  });

  it('refuses a second active global rule for the same item', async () => {
    const { admin, itemId } = await setup();
    await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, mode: 'fixed', period: 'daily', fixed_qty: 5 });
    const res = await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, mode: 'fixed', period: 'weekly', fixed_qty: 20 });
    expect(res.status).toBe(409);
  });

  it('refuses a camp official', async () => {
    const { itemId } = await setup();
    const official = await makeUser('camp_official');
    const res = await request(app).post('/api/distribution-rules').set(bearer(official))
      .send({ item_id: itemId, mode: 'fixed', period: 'daily', fixed_qty: 5 });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/distribution-rules/:id — editing a rule', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin change the quantity on an existing rule', async () => {
    const { admin, campAId, itemId } = await setup();
    const created = await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, camp_id: campAId, mode: 'fixed', period: 'daily', fixed_qty: 9 });

    const res = await request(app).patch(`/api/distribution-rules/${created.body.rule.id}`).set(bearer(admin))
      .send({ fixed_qty: 15 });
    expect(res.status).toBe(200);
    expect(res.body.rule.fixed_qty).toBe(15);
  });

  it('lets an admin deactivate a rule, freeing that camp+item for a new one', async () => {
    const { admin, campAId, itemId } = await setup();
    const created = await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, camp_id: campAId, mode: 'fixed', period: 'daily', fixed_qty: 9 });

    const deactivated = await request(app).patch(`/api/distribution-rules/${created.body.rule.id}`).set(bearer(admin))
      .send({ active: false });
    expect(deactivated.status).toBe(200);

    const replacement = await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, camp_id: campAId, mode: 'fixed', period: 'daily', fixed_qty: 20 });
    expect(replacement.status).toBe(201);
  });

  it('refuses an edit that would collide with another camp’s active rule for the same item', async () => {
    const { admin, campAId, campBId, itemId } = await setup();
    await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, camp_id: campAId, mode: 'fixed', period: 'daily', fixed_qty: 9 });
    const ruleB = await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, camp_id: campBId, mode: 'fixed', period: 'daily', fixed_qty: 3 });

    const res = await request(app).patch(`/api/distribution-rules/${ruleB.body.rule.id}`).set(bearer(admin))
      .send({ camp_id: campAId });
    expect(res.status).toBe(409);
  });

  it('404s for an unknown rule id', async () => {
    const { admin } = await setup();
    const res = await request(app).patch('/api/distribution-rules/000000000000000000000000').set(bearer(admin))
      .send({ fixed_qty: 15 });
    expect(res.status).toBe(404);
  });

  it('refuses a camp official', async () => {
    const { admin, campAId, itemId } = await setup();
    const created = await request(app).post('/api/distribution-rules').set(bearer(admin))
      .send({ item_id: itemId, camp_id: campAId, mode: 'fixed', period: 'daily', fixed_qty: 9 });
    const official = await makeUser('camp_official');
    const res = await request(app).patch(`/api/distribution-rules/${created.body.rule.id}`).set(bearer(official))
      .send({ fixed_qty: 15 });
    expect(res.status).toBe(403);
  });
});
