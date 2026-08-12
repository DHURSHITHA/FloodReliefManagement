import { describe, it, expect } from 'vitest';
import { createAreaSchema, createAlertSchema } from './area.schema.js';

const validArea = {
  name: 'Ward 12',
  district: 'North District',
  state: 'Assam',
  address: 'Near river embankment, Ward 12',
  latitude: 26.2,
  longitude: 91.7,
  severity: 'high',
};

describe('createAreaSchema', () => {
  it('accepts a complete area', () => {
    expect(createAreaSchema.safeParse(validArea).success).toBe(true);
  });

  it('accepts only the four defined severities', () => {
    for (const severity of ['low', 'medium', 'high', 'critical']) {
      expect(createAreaSchema.safeParse({ ...validArea, severity }).success).toBe(true);
    }
    expect(createAreaSchema.safeParse({ ...validArea, severity: 'extreme' }).success).toBe(false);
  });

  it('requires a name, district and coordinates', () => {
    expect(createAreaSchema.safeParse({ ...validArea, name: '' }).success).toBe(false);
    expect(createAreaSchema.safeParse({ ...validArea, latitude: undefined }).success).toBe(false);
  });

  it('rejects a latitude or longitude outside valid range', () => {
    expect(createAreaSchema.safeParse({ ...validArea, latitude: 200 }).success).toBe(false);
    expect(createAreaSchema.safeParse({ ...validArea, longitude: -200 }).success).toBe(false);
  });

  it('accepts optional estimated population and families', () => {
    const parsed = createAreaSchema.parse({ ...validArea, estimated_population: 1200, estimated_families: 260 });
    expect(parsed.estimated_population).toBe(1200);
  });
});

describe('createAlertSchema', () => {
  it('accepts a message and severity tied to an area', () => {
    const result = createAlertSchema.safeParse({ message: 'Water level rising fast.', severity: 'critical' });
    expect(result.success).toBe(true);
  });

  it('requires a non-empty message', () => {
    expect(createAlertSchema.safeParse({ message: '', severity: 'high' }).success).toBe(false);
  });
});
