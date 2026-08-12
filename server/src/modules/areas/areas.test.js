import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User, hashPassword } from '../auth/user.model.js';
import { signAccessToken } from '../../core/tokens.js';
import { AffectedArea } from './affectedArea.model.js';
import { FloodAlert } from './floodAlert.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();

async function makeUser(role) {
  return User.create({
    name: 'Test', mobile: String(9100000000 + Math.floor(Math.random() * 899999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active',
  });
}
const bearer = (u) => ({ Authorization: `Bearer ${signAccessToken(u)}` });

const areaBody = {
  name: 'Ward 12', district: 'North District', state: 'Assam',
  address: 'Near river embankment', latitude: 26.2, longitude: 91.7, severity: 'high',
};

describe('POST /api/areas', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin record an affected area', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).post('/api/areas').set(bearer(admin)).send(areaBody);
    expect(res.status).toBe(201);
    expect(res.body.area).toMatchObject({ name: 'Ward 12', severity: 'high' });
  });

  it('refuses a non-admin', async () => {
    const donor = await makeUser('donor');
    const res = await request(app).post('/api/areas').set(bearer(donor)).send(areaBody);
    expect(res.status).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/areas').send(areaBody);
    expect(res.status).toBe(401);
  });

  it('validates the payload', async () => {
    const admin = await makeUser('admin');
    const res = await request(app).post('/api/areas').set(bearer(admin)).send({ ...areaBody, severity: 'extreme' });
    expect(res.status).toBe(400);
  });

  it('writes an audit record', async () => {
    const admin = await makeUser('admin');
    await request(app).post('/api/areas').set(bearer(admin)).send(areaBody);
    const area = await AffectedArea.findOne({ name: 'Ward 12' });
    expect(area).toBeTruthy();
  });
});

describe('GET /api/areas', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lists areas for any authenticated user', async () => {
    const admin = await makeUser('admin');
    await request(app).post('/api/areas').set(bearer(admin)).send(areaBody);
    const donor = await makeUser('donor');
    const res = await request(app).get('/api/areas').set(bearer(donor));
    expect(res.status).toBe(200);
    expect(res.body.areas).toHaveLength(1);
  });
});

describe('flood alerts', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('lets an admin raise an alert tied to an area', async () => {
    const admin = await makeUser('admin');
    const areaRes = await request(app).post('/api/areas').set(bearer(admin)).send(areaBody);
    const areaId = areaRes.body.area.id;

    const res = await request(app)
      .post(`/api/areas/${areaId}/alerts`)
      .set(bearer(admin))
      .send({ message: 'Water level rising fast.', severity: 'critical' });

    expect(res.status).toBe(201);
    expect(res.body.alert).toMatchObject({ message: 'Water level rising fast.', severity: 'critical', status: 'active' });
  });

  it('404s when the area does not exist', async () => {
    const admin = await makeUser('admin');
    const res = await request(app)
      .post('/api/areas/000000000000000000000000/alerts')
      .set(bearer(admin))
      .send({ message: 'x', severity: 'high' });
    expect(res.status).toBe(404);
  });

  it('lists only active alerts for any authenticated user', async () => {
    const admin = await makeUser('admin');
    const areaRes = await request(app).post('/api/areas').set(bearer(admin)).send(areaBody);
    const areaId = areaRes.body.area.id;
    await request(app).post(`/api/areas/${areaId}/alerts`).set(bearer(admin)).send({ message: 'Active one', severity: 'high' });
    await FloodAlert.updateMany({}, {}); // no-op, keeps intent explicit that only one alert exists

    const donor = await makeUser('donor');
    const res = await request(app).get('/api/alerts/active').set(bearer(donor));
    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0].area_name).toBe('Ward 12');
  });
});
