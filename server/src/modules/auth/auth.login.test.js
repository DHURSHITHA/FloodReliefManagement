import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User } from './user.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();
const password = 'correct horse battery';
const signup = (over = {}) =>
  request(app).post('/api/auth/signup').send({
    name: 'Asha Kumari', mobile: '9876543210', password, role: 'affected_person', ...over,
  });

describe('POST /api/auth/login', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('logs in with a mobile number and returns an access token', async () => {
    await signup();
    const res = await request(app).post('/api/auth/login').send({ identifier: '9876543210', password });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toEqual(expect.any(String));
    expect(res.body.user.role).toBe('affected_person');
  });

  it('logs in with an email address', async () => {
    await signup({ mobile: undefined, email: 'asha@example.org' });
    const res = await request(app).post('/api/auth/login').send({ identifier: 'ASHA@example.org', password });
    expect(res.status).toBe(200);
  });

  it('sets an httpOnly refresh cookie that javascript cannot read', async () => {
    await signup();
    const res = await request(app).post('/api/auth/login').send({ identifier: '9876543210', password });
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('refresh_token='));
    expect(cookie).toBeTruthy();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('never puts the refresh token in the response body', async () => {
    await signup();
    const res = await request(app).post('/api/auth/login').send({ identifier: '9876543210', password });
    expect(res.body).not.toHaveProperty('refresh_token');
  });

  it('rejects a wrong password with 401 and a generic message', async () => {
    await signup();
    const res = await request(app).post('/api/auth/login').send({ identifier: '9876543210', password: 'wrong password!!' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    // Must not reveal whether the account exists.
    expect(res.body.error.message).not.toMatch(/password is incorrect|no such user/i);
  });

  it('gives an unknown identifier the same response as a wrong password', async () => {
    await signup();
    const unknown = await request(app).post('/api/auth/login').send({ identifier: '9000000000', password });
    const wrong = await request(app).post('/api/auth/login').send({ identifier: '9876543210', password: 'wrong password!!' });
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body.error.code).toBe(wrong.body.error.code);
  });

  it('refuses a camp official awaiting approval, with an explanatory code', async () => {
    await signup({ mobile: '9876543212', role: 'camp_official' });
    const res = await request(app).post('/api/auth/login').send({ identifier: '9876543212', password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_PENDING_APPROVAL');
  });

  it('refuses a disabled account', async () => {
    await signup();
    await User.updateOne({ mobile: '9876543210' }, { status: 'disabled' });
    const res = await request(app).post('/api/auth/login').send({ identifier: '9876543210', password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('records the login timestamp', async () => {
    await signup();
    await request(app).post('/api/auth/login').send({ identifier: '9876543210', password });
    const user = await User.findOne({ mobile: '9876543210' });
    expect(user.last_login_at).toBeInstanceOf(Date);
  });
});
