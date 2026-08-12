import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../app.js';
import * as notificationsService from './notifications.service.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9450000000 + Math.floor(Math.random() * 49999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active', ...over,
  });
}
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

const campBody = {
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7, flood_severity: 'high',
  beneficiary_capacity: 400, volunteer_capacity: 30, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
};

describe('notifications service', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates and lists a notification for a user, newest first', async () => {
    const userId = new mongoose.Types.ObjectId();
    await notificationsService.createNotification({ user_id: userId, type: 'low_stock', message: 'Rice is low.' });
    await notificationsService.createNotification({ user_id: userId, type: 'low_stock', message: 'Blankets are low.' });

    const list = await notificationsService.listNotifications(userId);
    expect(list).toHaveLength(2);
    expect(list[0].message).toBe('Blankets are low.');
  });

  it("does not list another user's notifications", async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    await notificationsService.createNotification({ user_id: userA, type: 'low_stock', message: 'A' });
    expect(await notificationsService.listNotifications(userB)).toHaveLength(0);
  });

  it('marks a notification read', async () => {
    const userId = new mongoose.Types.ObjectId();
    const n = await notificationsService.createNotification({ user_id: userId, type: 'low_stock', message: 'A' });
    const updated = await notificationsService.markRead(n._id, userId);
    expect(updated.read).toBe(true);
  });
});

describe('low-stock notification on inventory adjustment', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('notifies every admin, naming the item, when stock crosses the threshold', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody);
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const invRes = await request(app).post('/api/inventory').set(bearer(admin))
      .send({ camp_id: campRes.body.camp.id, item_id: itemRes.body.item.id, remaining_qty: 500, reorder_threshold: 50 });

    // Drop below the threshold.
    await request(app).patch(`/api/inventory/${invRes.body.inventory.id}`).set(bearer(admin)).send({ remaining_qty: 10 });

    const res = await request(app).get('/api/notifications').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].message).toContain('Rice');
    expect(res.body.notifications[0].type).toBe('low_stock');
  });

  it('does not notify while stock stays above the threshold', async () => {
    const admin = await makeUser('admin');
    const campRes = await request(app).post('/api/camps').set(bearer(admin)).send(campBody);
    const itemRes = await request(app).post('/api/resources').set(bearer(admin)).send({ name: 'Rice', category: 'food', unit: 'kg' });
    const invRes = await request(app).post('/api/inventory').set(bearer(admin))
      .send({ camp_id: campRes.body.camp.id, item_id: itemRes.body.item.id, remaining_qty: 500, reorder_threshold: 50 });

    await request(app).patch(`/api/inventory/${invRes.body.inventory.id}`).set(bearer(admin)).send({ remaining_qty: 300 });

    const res = await request(app).get('/api/notifications').set(bearer(admin));
    expect(res.body.notifications).toHaveLength(0);
  });
});
