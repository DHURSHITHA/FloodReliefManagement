import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { RefreshToken } from './refreshToken.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();
const password = 'correct horse battery';

async function loginAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/signup').send({
    name: 'Asha Kumari', mobile: '9876543210', password, role: 'affected_person',
  });
  const res = await agent.post('/api/auth/login').send({ identifier: '9876543210', password });
  return { agent, cookie: res.headers['set-cookie'] };
}

describe('POST /api/auth/refresh', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('exchanges a valid refresh cookie for a new access token', async () => {
    const { agent } = await loginAgent();
    const res = await agent.post('/api/auth/refresh').send();
    expect(res.status).toBe(200);
    expect(res.body.access_token).toEqual(expect.any(String));
  });

  it('rotates the token, so the old one stops working', async () => {
    const { agent, cookie } = await loginAgent();
    await agent.post('/api/auth/refresh').send();           // rotates
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', cookie).send();
    expect(replay.status).toBe(401);
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const { agent, cookie } = await loginAgent();
    const rotated = await agent.post('/api/auth/refresh').send();
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).send(); // theft signal

    // The legitimate current token must also stop working: we cannot tell
    // the thief from the victim, so every session for this user ends.
    const after = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', rotated.headers['set-cookie'])
      .send();
    expect(after.status).toBe(401);

    const live = await RefreshToken.countDocuments({ revoked_at: null });
    expect(live).toBe(0);
  });

  it('rejects a request with no cookie', async () => {
    const res = await request(app).post('/api/auth/refresh').send();
    expect(res.status).toBe(401);
  });

  it('rejects a forged token value', async () => {
    const res = await request(app).post('/api/auth/refresh').set('Cookie', ['refresh_token=deadbeef']).send();
    expect(res.status).toBe(401);
  });

  it('stores refresh tokens hashed, never in plaintext', async () => {
    const { cookie } = await loginAgent();
    const raw = cookie.find((c) => c.startsWith('refresh_token=')).split(';')[0].split('=')[1];
    expect(await RefreshToken.findOne({ token_hash: raw })).toBeNull();
    expect(await RefreshToken.countDocuments()).toBe(1);
  });
});

describe('POST /api/auth/logout', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('revokes the token and clears the cookie', async () => {
    const { agent } = await loginAgent();
    const res = await agent.post('/api/auth/logout').send();
    expect(res.status).toBe(204);
    expect(await RefreshToken.countDocuments({ revoked_at: null })).toBe(0);
    const retry = await agent.post('/api/auth/refresh').send();
    expect(retry.status).toBe(401);
  });

  it('succeeds even with no session, so logout is always safe to call', async () => {
    const res = await request(app).post('/api/auth/logout').send();
    expect(res.status).toBe(204);
  });
});
