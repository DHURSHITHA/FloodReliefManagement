import { describe, it, expect } from 'vitest';
import { createResourceItemSchema, createInventorySchema } from './resource.schema.js';

describe('createResourceItemSchema', () => {
  it('accepts a complete resource item', () => {
    const result = createResourceItemSchema.safeParse({ name: 'Rice', category: 'food', unit: 'kg' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid category', () => {
    const result = createResourceItemSchema.safeParse({ name: 'Rice', category: 'invalid', unit: 'kg' });
    expect(result.success).toBe(false);
  });
});

describe('createInventorySchema', () => {
  const campId = '507f1f77bcf86cd799439011';
  const itemId = '507f1f77bcf86cd799439012';

  it('accepts a complete inventory entry', () => {
    const result = createInventorySchema.safeParse({
      camp_id: campId, item_id: itemId, remaining_qty: 500, reorder_threshold: 50,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative remaining_qty', () => {
    const result = createInventorySchema.safeParse({
      camp_id: campId, item_id: itemId, remaining_qty: -1, reorder_threshold: 50,
    });
    expect(result.success).toBe(false);
  });
});
