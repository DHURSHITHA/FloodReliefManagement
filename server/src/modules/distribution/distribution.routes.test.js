import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9700000000 + Math.floor(Math.random() * 299999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active', ...over,
  });
}
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

const campBody = {
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7, flood_severity: 'high',
  beneficiary_capacity: 10, volunteer_capacity: 5, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
};

async function setup() {
  const admin = await makeUser('admin');
  const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody);
  const campId = campRes.body.camp.id;

  const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
  const itemId = itemRes.body.item.id;

  await request(app).post('/api/inventory').set(bearer(admin))
    .send({ camp_id: campId, item_id: itemId, remaining_qty: 500, reorder_threshold: 50 });
  await request(app).post('/api/distribution-rules').set(bearer(admin))
    .send({ item_id: itemId, mode: 'fixed', period: 'daily', fixed_qty: 5 });

  const person = await makeUser('affected_person');
  const regRes = await request(app).post('/api/registrations').set(bearer(person)).send({
    camp_id: campId,
    members: [{ name: 'Meena Devi', age: 34, gender: 'female', aadhaar: '234567897011', mobile: '9876543210', address: '12 River Road' }],
  });
  const beneficiaryId = regRes.body.beneficiary.id;
  await request(app)
    .post(`/api/registrations/${beneficiaryId}/members/${regRes.body.members[0].id}/checkin`)
    .set(bearer(admin));

  return { admin, campId, itemId, beneficiaryId };
}

describe('POST /api/distributions', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin distribute an item', async () => {
    const { admin, itemId, beneficiaryId } = await setup();
    const res = await request(app).post('/api/distributions').set(bearer(admin)).send({ beneficiary_id: beneficiaryId, item_id: itemId });
    expect(res.status).toBe(201);
    expect(res.body.distribution.quantity).toBe(5);
  });

  it('refuses a donor', async () => {
    const { itemId, beneficiaryId } = await setup();
    const donor = await makeUser('donor');
    const res = await request(app).post('/api/distributions').set(bearer(donor)).send({ beneficiary_id: beneficiaryId, item_id: itemId });
    expect(res.status).toBe(403);
  });

  it('returns 409 ALREADY_DISTRIBUTED on a same-day repeat', async () => {
    const { admin, itemId, beneficiaryId } = await setup();
    await request(app).post('/api/distributions').set(bearer(admin)).send({ beneficiary_id: beneficiaryId, item_id: itemId });
    const res = await request(app).post('/api/distributions').set(bearer(admin)).send({ beneficiary_id: beneficiaryId, item_id: itemId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_DISTRIBUTED');
  });

  it('drops the camp inventory by the distributed amount', async () => {
    const { admin, campId, itemId, beneficiaryId } = await setup();
    await request(app).post('/api/distributions').set(bearer(admin)).send({ beneficiary_id: beneficiaryId, item_id: itemId });

    const inv = await request(app).get(`/api/inventory?camp_id=${campId}`).set(bearer(admin));
    expect(inv.body.inventory[0].remaining_qty).toBe(495);
    expect(inv.body.inventory[0].distributed_qty).toBe(5);
  });
});

describe('GET /api/distributions', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lists distributions filtered by beneficiary', async () => {
    const { admin, itemId, beneficiaryId } = await setup();
    await request(app).post('/api/distributions').set(bearer(admin)).send({ beneficiary_id: beneficiaryId, item_id: itemId });

    const res = await request(app).get(`/api/distributions?beneficiary=${beneficiaryId}`).set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.distributions).toHaveLength(1);
  });
});
