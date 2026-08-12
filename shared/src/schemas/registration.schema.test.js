import { describe, it, expect } from 'vitest';
import { createRegistrationSchema, searchRegistrationsQuerySchema } from './registration.schema.js';

const validAadhaar = '234567890107'; // passes the Verhoeff checksum

const applicant = (over = {}) => ({
  name: 'Meena Devi', age: 34, gender: 'female', aadhaar: validAadhaar,
  mobile: '9876543210', address: '12 River Road, Ward 12', ...over,
});
const familyMember = (over = {}) => ({
  name: 'Raju Devi', age: 8, gender: 'male', aadhaar: '234567890111',
  relation_to_applicant: 'child', ...over,
});

describe('createRegistrationSchema', () => {
  const campId = '507f1f77bcf86cd799439011';

  it('accepts an applicant registering alone', () => {
    const result = createRegistrationSchema.safeParse({ camp_id: campId, members: [applicant()] });
    expect(result.success).toBe(true);
  });

  it('accepts an applicant with family members', () => {
    const result = createRegistrationSchema.safeParse({
      camp_id: campId, members: [applicant(), familyMember()],
    });
    expect(result.success).toBe(true);
  });

  it('requires mobile and address for the applicant', () => {
    const result = createRegistrationSchema.safeParse({
      camp_id: campId, members: [applicant({ mobile: undefined, address: undefined })],
    });
    expect(result.success).toBe(false);
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('members.0.mobile');
    expect(paths).toContain('members.0.address');
  });

  it('requires relation_to_applicant for non-applicant members', () => {
    const result = createRegistrationSchema.safeParse({
      camp_id: campId, members: [applicant(), familyMember({ relation_to_applicant: undefined })],
    });
    expect(result.success).toBe(false);
    expect(result.error.issues.map((i) => i.path.join('.'))).toContain('members.1.relation_to_applicant');
  });

  it('rejects an invalid Aadhaar number', () => {
    const result = createRegistrationSchema.safeParse({
      camp_id: campId, members: [applicant({ aadhaar: '123456789012' })],
    });
    expect(result.success).toBe(false);
  });

  it('requires at least one member', () => {
    const result = createRegistrationSchema.safeParse({ camp_id: campId, members: [] });
    expect(result.success).toBe(false);
  });
});

describe('searchRegistrationsQuerySchema', () => {
  it('requires a non-empty search term', () => {
    expect(searchRegistrationsQuerySchema.safeParse({ search: '' }).success).toBe(false);
    expect(searchRegistrationsQuerySchema.safeParse({ search: 'BEN-1001' }).success).toBe(true);
  });
});
