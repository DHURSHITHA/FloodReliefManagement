import { describe, it, expect } from 'vitest';
import { upsertDonorProfileSchema, DONOR_TYPES } from './donor.schema.js';

const validIndividual = {
  donor_type: 'individual', name: 'Meera Iyer', mobile: '9876543210', address: '4 Lake View Road',
};
const validNgo = {
  donor_type: 'ngo', name: 'Riverside Relief Trust', contact_person: 'Arjun Nair',
  mobile: '9876543210', address: 'Registered Office, MG Road', registration_details: 'Reg. No. TN/2019/04521',
};

describe('upsertDonorProfileSchema', () => {
  it('names both §6.12 donor types', () => {
    expect(DONOR_TYPES).toEqual(['individual', 'ngo']);
  });

  it('accepts a well-formed individual donor', () => {
    expect(upsertDonorProfileSchema.safeParse(validIndividual).success).toBe(true);
  });

  it('accepts a well-formed NGO donor', () => {
    expect(upsertDonorProfileSchema.safeParse(validNgo).success).toBe(true);
  });

  it('requires a contact person for an NGO', () => {
    const { contact_person, ...rest } = validNgo;
    const result = upsertDonorProfileSchema.safeParse(rest);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path[0] === 'contact_person')).toBe(true);
  });

  it('requires registration details for an NGO', () => {
    const { registration_details, ...rest } = validNgo;
    const result = upsertDonorProfileSchema.safeParse(rest);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path[0] === 'registration_details')).toBe(true);
  });

  it('does not require a contact person or registration details for an individual', () => {
    expect(upsertDonorProfileSchema.safeParse(validIndividual).success).toBe(true);
  });

  it('rejects an invalid mobile number', () => {
    const result = upsertDonorProfileSchema.safeParse({ ...validIndividual, mobile: '12345' });
    expect(result.success).toBe(false);
  });
});
