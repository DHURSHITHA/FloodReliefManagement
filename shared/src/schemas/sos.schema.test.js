import { describe, it, expect } from 'vitest';
import { createSosSchema, updateSosSchema, SOS_CATEGORIES } from './sos.schema.js';

const validCreate = {
  camp_id: '64b64b64b64b64b64b64b64b',
  category: 'medical',
  urgency: 'high',
  description: 'A woman in tent 4 is having chest pains and needs help now.',
  location: 'Tent block 4',
};

describe('createSosSchema', () => {
  it('accepts a well-formed report', () => {
    expect(createSosSchema.safeParse(validCreate).success).toBe(true);
  });

  it('names all six §6.11 categories', () => {
    expect(SOS_CATEGORIES).toEqual([
      'medical', 'security', 'food_shortage', 'water_shortage', 'missing_person', 'other',
    ]);
  });

  it('rejects a description under 10 characters', () => {
    const result = createSosSchema.safeParse({ ...validCreate, description: 'help' });
    expect(result.success).toBe(false);
  });

  it('rejects a location under 2 characters', () => {
    const result = createSosSchema.safeParse({ ...validCreate, location: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown category', () => {
    const result = createSosSchema.safeParse({ ...validCreate, category: 'fire' });
    expect(result.success).toBe(false);
  });
});

describe('updateSosSchema', () => {
  it('accepts acknowledging with no note', () => {
    expect(updateSosSchema.safeParse({ status: 'acknowledged' }).success).toBe(true);
  });

  it('requires a note to resolve', () => {
    const result = updateSosSchema.safeParse({ status: 'resolved' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['note']);
  });

  it('requires a note to close', () => {
    const result = updateSosSchema.safeParse({ status: 'closed' });
    expect(result.success).toBe(false);
  });

  it('accepts resolving with a note', () => {
    const result = updateSosSchema.safeParse({ status: 'resolved', note: 'Sent to the medical tent, stable now.' });
    expect(result.success).toBe(true);
  });

  it('rejects "open" as a target status — it is the initial state, not a transition', () => {
    const result = updateSosSchema.safeParse({ status: 'open' });
    expect(result.success).toBe(false);
  });

  it('treats an empty-string note as absent, not a real note', () => {
    const result = updateSosSchema.safeParse({ status: 'resolved', note: '' });
    expect(result.success).toBe(false);
  });
});
