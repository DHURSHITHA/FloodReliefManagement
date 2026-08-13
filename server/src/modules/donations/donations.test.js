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
