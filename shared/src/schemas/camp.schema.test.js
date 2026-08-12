import { describe, it, expect } from 'vitest';
import { createCampSchema } from './camp.schema.js';

const valid = {
  name: 'Riverside Community Hall',
  camp_type: 'community_hall',
  description: 'Ground-floor hall, wheelchair accessible.',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam',
  pincode: '781001', latitude: 26.2, longitude: 91.7,
  flood_severity: 'high',
  beneficiary_capacity: 400, volunteer_capacity: 30, duration_days: 14,
  facilities: { food: true, drinking_water: true, medical_support: true, toilets_count: 12 },
  assigned_official_id: '507f1f77bcf86cd799439011',
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
};

describe('createCampSchema', () => {
  it('accepts a complete camp', () => {
    const result = createCampSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('requires beneficiary capacity, volunteer capacity and duration (section 6.3 mandatory fields)', () => {
    expect(createCampSchema.safeParse({ ...valid, beneficiary_capacity: undefined }).success).toBe(false);
    expect(createCampSchema.safeParse({ ...valid, volunteer_capacity: undefined }).success).toBe(false);
    expect(createCampSchema.safeParse({ ...valid, duration_days: undefined }).success).toBe(false);
  });

  it('requires both emergency contacts', () => {
    expect(createCampSchema.safeParse({ ...valid, nearest_hospital_contact: undefined }).success).toBe(false);
    expect(createCampSchema.safeParse({ ...valid, nearest_police_contact: undefined }).success).toBe(false);
  });

  it('rejects a negative or zero capacity', () => {
    expect(createCampSchema.safeParse({ ...valid, beneficiary_capacity: 0 }).success).toBe(false);
    expect(createCampSchema.safeParse({ ...valid, volunteer_capacity: -5 }).success).toBe(false);
  });

  it('accepts only the four defined camp types', () => {
    for (const t of ['school', 'auditorium', 'community_hall', 'other']) {
      expect(createCampSchema.safeParse({ ...valid, camp_type: t }).success).toBe(true);
    }
    expect(createCampSchema.safeParse({ ...valid, camp_type: 'stadium' }).success).toBe(false);
  });

  it('defaults every facility flag to false and toilets_count to 0 when omitted', () => {
    const { facilities, ...rest } = valid;
    const parsed = createCampSchema.parse(rest);
    expect(parsed.facilities).toEqual({
      food: false, drinking_water: false, medical_support: false, toilets_count: 0,
      electricity: false, accommodation: false, charging_points: false, internet: false,
      child_care: false, womens_facilities: false, disability_friendly: false,
    });
  });
});
