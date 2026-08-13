import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9700000000 + Math.floor(Math.random() * 99999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active', ...over,
  });
}
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

const donorProfileBody = (over = {}) => ({
  donor_type: 'individual', name: 'Meera Iyer', mobile: '9876543210', address: '4 Lake View Road', ...over,
});

describe('donor profile (requirements §6.12)', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('shows no profile before one is created', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).get('/api/donors/me').set(bearer(donor));
    expect(res.status).toBe(200);
    expect(res.body.donor).toBeNull();
  });

  it('lets a donor create their own profile', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).post('/api/donors/me').set(bearer(donor)).send(donorProfileBody());
    expect(res.status).toBe(200);
    expect(res.body.donor.name).toBe('Meera Iyer');
    expect(res.body.donor.donor_type).toBe('individual');
  });

  it('lets a donor update their own profile without creating a second one', async () => {
    const donor = await makeUser('donor');
    await request(app).post('/api/donors/me').set(bearer(donor)).send(donorProfileBody());
    const res = await request(app).post('/api/donors/me').set(bearer(donor)).send(donorProfileBody({ name: 'Meera S. Iyer' }));

    expect(res.status).toBe(200);
    expect(res.body.donor.name).toBe('Meera S. Iyer');

    const mine = await request(app).get('/api/donors/me').set(bearer(donor));
    expect(mine.body.donor.name).toBe('Meera S. Iyer');
  });

  it('requires an NGO to supply a contact person and registration details', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).post('/api/donors/me').set(bearer(donor)).send({
      donor_type: 'ngo', name: 'Riverside Relief Trust', mobile: '9876543210', address: 'MG Road',
    });
    expect(res.status).toBe(400);
  });

  it('refuses an affected person', async () => {
    const person = await makeUser('affected_person');
    const res = await request(app).post('/api/donors/me').set(bearer(person)).send(donorProfileBody());
    expect(res.status).toBe(403);
  });
});

import { Notification } from '../notifications/notification.model.js';
import { Inventory } from '../resources/inventory.model.js';

const campBody = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7, flood_severity: 'high',
  beneficiary_capacity: 10, volunteer_capacity: 5, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

async function makeDonor(over = {}) {
  const user = await makeUser('donor');
  await request(app).post('/api/donors/me').set(bearer(user)).send(donorProfileBody(over));
  return user;
}

describe('raising a donation (requirements §6.13)', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets a donor record a financial donation and issues a DON- code', async () => {
    const donor = await makeDonor();
    const res = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 5000, payment_method: 'UPI', payment_reference: 'txn_9182',
    });
    expect(res.status).toBe(201);
    expect(res.body.donation.donation_code).toMatch(/^DON-\d+$/);
    expect(res.body.donation.status).toBe('pending');
    expect(res.body.donation.amount).toBe(5000);
  });

  it('lets a donor record a material donation and copies the item label from the catalogue', async () => {
    const admin = await makeUser('admin');
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const donor = await makeDonor();

    const res = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material',
      materials: [{ resource_item_id: itemRes.body.item.id, quantity: 100, unit: 'kg' }],
    });

    expect(res.status).toBe(201);
    expect(res.body.donation.materials).toHaveLength(1);
    expect(res.body.donation.materials[0].item_label).toBe('Rice');
    expect(res.body.donation.materials[0].category).toBe('food');
  });

  it('refuses a donation from a donor with no profile yet', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });
    expect(res.status).toBe(400);
  });

  it('lets an admin record a donation on an existing donor\'s behalf', async () => {
    const donor = await makeDonor();
    const donorRes = await request(app).get('/api/donors/me').set(bearer(donor));
    const admin = await makeUser('admin');

    const res = await request(app).post('/api/donations').set(bearer(admin)).send({
      donation_type: 'financial', donor_id: donorRes.body.donor.id, amount: 2000, payment_method: 'cheque',
    });

    expect(res.status).toBe(201);
    expect(res.body.donation.donor_id).toBe(donorRes.body.donor.id);
    expect(res.body.donation.recorded_by).not.toBe(donorRes.body.donor.user_id);
  });

  it('rejects an admin recording a donation with no donor_id', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).post('/api/donations').set(bearer(admin)).send({
      donation_type: 'financial', amount: 2000, payment_method: 'cheque',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a material donation naming an item that does not exist', async () => {
    const donor = await makeDonor();
    const res = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material',
      materials: [{ resource_item_id: '64b64b64b64b64b64b64b64b', quantity: 10, unit: 'kg' }],
    });
    expect(res.status).toBe(400);
  });

  it('notifies every admin when a donation is recorded', async () => {
    const adminA = await makeUser('admin');
    const adminB = await makeUser('admin');
    const donor = await makeDonor();

    await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });

    expect(await Notification.countDocuments({ user_id: adminA._id, type: 'donation' })).toBe(1);
    expect(await Notification.countDocuments({ user_id: adminB._id, type: 'donation' })).toBe(1);
  });

  it('refuses a camp official', async () => {
    const official = await makeUser('camp_official');
    const res = await request(app).post('/api/donations').set(bearer(official)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });
    expect(res.status).toBe(403);
  });
});

describe('deciding a donation (requirements §4.1, §4.2 of the M2 design)', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('confirms a financial donation with no stock side effects', async () => {
    const admin = await makeUser('admin');
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 5000, payment_method: 'UPI',
    });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(admin))
      .send({ action: 'confirm' });

    expect(res.status).toBe(200);
    expect(res.body.donation.status).toBe('confirmed');
    expect(res.body.donation.confirmed_by).toBe(admin._id.toString());
    expect(res.body.donation.confirmed_at).not.toBeNull();
  });

  it('rejects a material donation confirmation with no target camp', async () => {
    const admin = await makeUser('admin');
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material', materials: [{ resource_item_id: itemRes.body.item.id, quantity: 100, unit: 'kg' }],
    });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(admin))
      .send({ action: 'confirm' });

    expect(res.status).toBe(400);
  });

  it('posts stock for every line of a confirmed material donation, into the target camp only', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const otherCampRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody({ name: 'Hilltop School' }));
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material', target_camp_id: campRes.body.camp.id,
      materials: [{ resource_item_id: itemRes.body.item.id, quantity: 100, unit: 'kg' }],
    });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(admin))
      .send({ action: 'confirm' });

    expect(res.status).toBe(200);
    const inv = await Inventory.findOne({ camp_id: campRes.body.camp.id, item_id: itemRes.body.item.id });
    expect(inv.remaining_qty).toBe(100);
    expect(await Inventory.countDocuments({ camp_id: otherCampRes.body.camp.id })).toBe(0);
  });

  // Task 3's receiveStock deviation (docs/superpowers/plans/2026-08-13-m2-plan2-donors-and-donations.md)
  // scopes the "one lot per camp/item" merge to source: 'donation' lots only,
  // so a manually-created batch (POST /api/inventory, source: 'manual') stays
  // a separate document by design -- this test seeds the existing lot via a
  // prior donation confirmation instead, which is what actually exercises
  // receiveStock's merge path.
  it('adds donated stock to an existing donation-sourced lot rather than creating a second one', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const donor = await makeDonor();

    const first = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material', target_camp_id: campRes.body.camp.id,
      materials: [{ resource_item_id: itemRes.body.item.id, quantity: 40, unit: 'kg' }],
    });
    await request(app).patch(`/api/donations/${first.body.donation.id}/confirm`).set(bearer(admin)).send({ action: 'confirm' });

    const second = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material', target_camp_id: campRes.body.camp.id,
      materials: [{ resource_item_id: itemRes.body.item.id, quantity: 100, unit: 'kg' }],
    });
    await request(app).patch(`/api/donations/${second.body.donation.id}/confirm`).set(bearer(admin)).send({ action: 'confirm' });

    expect(await Inventory.countDocuments({ camp_id: campRes.body.camp.id, item_id: itemRes.body.item.id })).toBe(1);
    const inv = await Inventory.findOne({ camp_id: campRes.body.camp.id, item_id: itemRes.body.item.id });
    expect(inv.remaining_qty).toBe(140);
  });

  it('rejects with a reason and never touches stock', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody());
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'material', target_camp_id: campRes.body.camp.id,
      materials: [{ resource_item_id: itemRes.body.item.id, quantity: 100, unit: 'kg' }],
    });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(admin))
      .send({ action: 'reject', rejection_reason: 'Item mismatch with what was actually delivered.' });

    expect(res.status).toBe(200);
    expect(res.body.donation.status).toBe('rejected');
    expect(await Inventory.countDocuments({ camp_id: campRes.body.camp.id })).toBe(0);
  });

  it('rejects a reject with no reason', async () => {
    const admin = await makeUser('admin');
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(admin))
      .send({ action: 'reject' });
    expect(res.status).toBe(400);
  });

  it('refuses to decide an already-decided donation twice', async () => {
    const admin = await makeUser('admin');
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });
    await request(app).patch(`/api/donations/${created.body.donation.id}/confirm`).set(bearer(admin)).send({ action: 'confirm' });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(admin))
      .send({ action: 'confirm' });
    expect(res.status).toBe(409);
  });

  it('notifies the donor of the decision', async () => {
    const admin = await makeUser('admin');
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });

    await request(app).patch(`/api/donations/${created.body.donation.id}/confirm`).set(bearer(admin)).send({ action: 'confirm' });

    expect(await Notification.countDocuments({ user_id: donor._id, type: 'donation_update' })).toBe(1);
  });

  it('refuses a camp official', async () => {
    const admin = await makeUser('admin');
    const official = await makeUser('camp_official');
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({
      donation_type: 'financial', amount: 1000, payment_method: 'cash',
    });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(official))
      .send({ action: 'confirm' });
    expect(res.status).toBe(403);
  });
});

describe('listing donations', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('shows a donor only their own donations, materials included', async () => {
    const admin = await makeUser('admin');
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const donorA = await makeDonor({ name: 'Meera Iyer' });
    const donorB = await makeDonor({ name: 'Arjun Nair' });

    await request(app).post('/api/donations').set(bearer(donorA)).send({
      donation_type: 'material', materials: [{ resource_item_id: itemRes.body.item.id, quantity: 50, unit: 'kg' }],
    });
    await request(app).post('/api/donations').set(bearer(donorB)).send({ donation_type: 'financial', amount: 1000, payment_method: 'cash' });

    const res = await request(app).get('/api/donations/mine').set(bearer(donorA));
    expect(res.status).toBe(200);
    expect(res.body.donations).toHaveLength(1);
    expect(res.body.donations[0].materials).toHaveLength(1);
    expect(res.body.donations[0].materials[0].item_label).toBe('Rice');
  });

  it('shows an empty list for a donor with no donations yet', async () => {
    const donor = await makeDonor();
    const res = await request(app).get('/api/donations/mine').set(bearer(donor));
    expect(res.body.donations).toEqual([]);
  });

  it('lets an admin list every donation, filterable by status', async () => {
    const admin = await makeUser('admin');
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({ donation_type: 'financial', amount: 1000, payment_method: 'cash' });
    await request(app).patch(`/api/donations/${created.body.donation.id}/confirm`).set(bearer(admin)).send({ action: 'confirm' });
    await request(app).post('/api/donations').set(bearer(donor)).send({ donation_type: 'financial', amount: 500, payment_method: 'cash' });

    const pending = await request(app).get('/api/donations?status=pending').set(bearer(admin));
    expect(pending.body.donations).toHaveLength(1);
    expect(pending.body.donations[0].status).toBe('pending');

    const all = await request(app).get('/api/donations').set(bearer(admin));
    expect(all.body.donations).toHaveLength(2);
  });

  it('shows the admin the donor\'s name on each donation', async () => {
    const admin = await makeUser('admin');
    const donor = await makeDonor({ name: 'Meera Iyer' });
    await request(app).post('/api/donations').set(bearer(donor)).send({ donation_type: 'financial', amount: 1000, payment_method: 'cash' });

    const res = await request(app).get('/api/donations').set(bearer(admin));
    expect(res.body.donations[0].donor_name).toBe('Meera Iyer');
  });

  it('refuses a donor listing every donation', async () => {
    const donor = await makeDonor();
    const res = await request(app).get('/api/donations').set(bearer(donor));
    expect(res.status).toBe(403);
  });

  it('refuses an admin reading /donations/mine', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).get('/api/donations/mine').set(bearer(admin));
    expect(res.status).toBe(403);
  });
});

describe('cross-role leakage', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('a donor cannot read another donor\'s profile through any donation payload', async () => {
    const admin = await makeUser('admin');
    const donorA = await makeDonor({ name: 'Meera Iyer', mobile: '9876543210' });
    const donorB = await makeDonor({ name: 'Arjun Nair', mobile: '9123456780' });
    await request(app).post('/api/donations').set(bearer(donorA)).send({ donation_type: 'financial', amount: 1000, payment_method: 'cash' });

    const res = await request(app).get('/api/donations/mine').set(bearer(donorB));
    expect(res.body.donations).toEqual([]);
  });

  it('an admin-recorded donation for donor A cannot be listed under donor B\'s account', async () => {
    const admin = await makeUser('admin');
    const donorA = await makeDonor();
    const donorARes = await request(app).get('/api/donors/me').set(bearer(donorA));
    const donorB = await makeDonor();

    await request(app).post('/api/donations').set(bearer(admin)).send({
      donation_type: 'financial', donor_id: donorARes.body.donor.id, amount: 3000, payment_method: 'cheque',
    });

    const res = await request(app).get('/api/donations/mine').set(bearer(donorB));
    expect(res.body.donations).toEqual([]);
  });

  it('a donor cannot decide their own donation', async () => {
    const donor = await makeDonor();
    const created = await request(app).post('/api/donations').set(bearer(donor)).send({ donation_type: 'financial', amount: 1000, payment_method: 'cash' });

    const res = await request(app)
      .patch(`/api/donations/${created.body.donation.id}/confirm`)
      .set(bearer(donor))
      .send({ action: 'confirm' });
    expect(res.status).toBe(403);
  });

  it('an affected person cannot reach any donation route', async () => {
    const person = await makeUser('affected_person');
    expect((await request(app).post('/api/donations').set(bearer(person)).send({ donation_type: 'financial', amount: 1, payment_method: 'cash' })).status).toBe(403);
    expect((await request(app).get('/api/donations/mine').set(bearer(person))).status).toBe(403);
    expect((await request(app).get('/api/donations').set(bearer(person))).status).toBe(403);
  });
});
