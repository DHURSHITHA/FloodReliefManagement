import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9250000000 + Math.floor(Math.random() * 49999999)),
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

describe('GET /api/dashboard/summary', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('computes camp, beneficiary, and volunteer counts from stored data', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody);
    const person = await makeUser('affected_person');
    await request(app).post('/api/registrations').set(bearer(person)).send({
      camp_id: campRes.body.camp.id,
      members: [{
        name: 'Meena Devi', age: 34, gender: 'female', aadhaar: '234567897024',
        mobile: '9876543210', address: '12 River Road', wants_to_volunteer: true,
      }],
    });

    const res = await request(app).get('/api/dashboard/summary').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.camps.total).toBe(1);
    expect(res.body.beneficiaries.total_registered).toBe(1);
    expect(res.body.volunteers.accepted).toBe(1);
  });

  it('reports registered and checked-in as separate figures', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody);
    const person = await makeUser('affected_person');
    const regRes = await request(app).post('/api/registrations').set(bearer(person)).send({
      camp_id: campRes.body.camp.id,
      members: [
        { name: 'Meena Devi', age: 34, gender: 'female', aadhaar: '234567897030', mobile: '9876543210', address: '12 River Road' },
        { name: 'Raju', age: 8, gender: 'male', aadhaar: '234567897007', relation_to_applicant: 'child' },
      ],
    });
    // Check in only one of the two.
    await request(app)
      .post(`/api/registrations/${regRes.body.beneficiary.id}/members/${regRes.body.members[0].id}/checkin`)
      .set(bearer(admin));

    const res = await request(app).get('/api/dashboard/summary').set(bearer(admin));
    expect(res.body.beneficiaries.total_registered).toBe(1); // one household
    expect(res.body.beneficiaries.total_checked_in).toBe(1); // one of two people
    expect(res.body.beneficiaries.high_priority).toBe(1);    // the 8-year-old
  });

  it('counts low-stock inventory entries', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody);
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    await request(app).post('/api/inventory').set(bearer(admin))
      .send({ camp_id: campRes.body.camp.id, item_id: itemRes.body.item.id, remaining_qty: 10, reorder_threshold: 50 });

    const res = await request(app).get('/api/dashboard/summary').set(bearer(admin));
    expect(res.body.inventory.low_stock).toBe(1);
  });

  it('refuses a donor', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).get('/api/dashboard/summary').set(bearer(donor));
    expect(res.status).toBe(403);
  });
});
