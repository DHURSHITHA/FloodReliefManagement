import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { User } from './user.model.js';
import { AuditLog } from '../audit/audit.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const app = createApp();
const body = {
  name: 'Asha Kumari',
  mobile: '9876543210',
  password: 'correct horse battery',
  role: 'affected_person',
};

describe('POST /api/auth/signup', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates an active affected person', async () => {
    const res = await request(app).post('/api/auth/signup').send(body);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Asha Kumari', role: 'affected_person', status: 'active' });
    expect(res.body.user.id).toBeTruthy();
  });

  it('never returns the password or its hash', async () => {
    const res = await request(app).post('/api/auth/signup').send(body);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/correct horse battery/);
    expect(serialized).not.toMatch(/password/i);
  });

  it('stores a bcrypt hash, never the plaintext', async () => {
    await request(app).post('/api/auth/signup').send(body);
    const user = await User.findOne({ mobile: '9876543210' }).select('+password_hash');
    expect(user.password_hash).not.toBe(body.password);
    expect(user.password_hash).toMatch(/^\$2[aby]\$12\$/); // bcrypt, cost 12
  });

  it('places a camp official in pending_approval', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...body, mobile: '9876543211', role: 'camp_official' });
    expect(res.status).toBe(201);
    expect(res.body.user.status).toBe('pending_approval');
  });

  it('rejects a duplicate mobile with a 409 and a field-level detail', async () => {
    await request(app).post('/api/auth/signup').send(body);
    const res = await request(app).post('/api/auth/signup').send({ ...body, name: 'Someone Else' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.some((d) => d.path === 'mobile')).toBe(true);
  });

  it('rejects a duplicate email regardless of casing', async () => {
    const withEmail = { ...body, mobile: undefined, email: 'asha@example.org' };
    await request(app).post('/api/auth/signup').send(withEmail);
    const res = await request(app).post('/api/auth/signup').send({ ...withEmail, email: 'ASHA@EXAMPLE.ORG' });
    expect(res.status).toBe(409);
  });

  it('returns field-level validation errors the form can display', async () => {
    const res = await request(app).post('/api/auth/signup').send({ ...body, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.some((d) => d.path === 'password')).toBe(true);
  });

  it('rejects a volunteer role, which does not exist', async () => {
    const res = await request(app).post('/api/auth/signup').send({ ...body, role: 'volunteer' });
    expect(res.status).toBe(400);
  });

  it('writes an audit record', async () => {
    await request(app).post('/api/auth/signup').send(body);
    const entry = await AuditLog.findOne({ action: 'user.signup' });
    expect(entry).toBeTruthy();
    expect(entry.module).toBe('auth');
    expect(JSON.stringify(entry.after)).not.toMatch(/password/i);
  });
});
