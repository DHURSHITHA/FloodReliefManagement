import { describe, it, expect } from 'vitest';
import { signupSchema, loginSchema } from './auth.schema.js';

const valid = {
  name: 'Asha Kumari',
  mobile: '9876543210',
  password: 'correct horse battery',
  role: 'affected_person',
};

describe('signupSchema', () => {
  it('accepts a signup with a mobile and no email', () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a signup with an email and no mobile', () => {
    const { mobile, ...rest } = valid;
    expect(signupSchema.safeParse({ ...rest, email: 'asha@example.org' }).success).toBe(true);
  });

  it('rejects a signup with neither mobile nor email', () => {
    const { mobile, ...rest } = valid;
    const result = signupSchema.safeParse(rest);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error.issues)).toMatch(/mobile or an email/i);
  });

  it('requires a ten-digit Indian mobile starting 6 to 9', () => {
    expect(signupSchema.safeParse({ ...valid, mobile: '1234567890' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, mobile: '98765' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, mobile: '+919876543210' }).success).toBe(true);
  });

  it('requires a password of at least twelve characters', () => {
    expect(signupSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
  });

  it('accepts only the four defined roles and rejects volunteer', () => {
    for (const role of ['admin', 'camp_official', 'affected_person', 'donor']) {
      expect(signupSchema.safeParse({ ...valid, role }).success).toBe(true);
    }
    expect(signupSchema.safeParse({ ...valid, role: 'volunteer' }).success).toBe(false);
  });

  it('trims the name and lowercases the email', () => {
    const parsed = signupSchema.parse({ ...valid, name: '  Asha  ', email: 'ASHA@Example.ORG' });
    expect(parsed.name).toBe('Asha');
    expect(parsed.email).toBe('asha@example.org');
  });
});

describe('loginSchema', () => {
  it('accepts an identifier and password', () => {
    expect(loginSchema.safeParse({ identifier: 'asha@example.org', password: 'x'.repeat(12) }).success).toBe(true);
  });

  it('rejects a blank identifier', () => {
    expect(loginSchema.safeParse({ identifier: '', password: 'x'.repeat(12) }).success).toBe(false);
  });
});
