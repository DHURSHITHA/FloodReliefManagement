import { describe, it, expect } from 'vitest';
import { createDistributionRuleSchema, updateDistributionRuleSchema, distributeItemSchema } from './distributionRule.schema.js';

const itemId = '507f1f77bcf86cd799439012';
const beneficiaryId = '507f1f77bcf86cd799439013';
const campId = '507f1f77bcf86cd799439014';

describe('createDistributionRuleSchema', () => {
  it('accepts a fixed-mode rule', () => {
    const result = createDistributionRuleSchema.safeParse({
      item_id: itemId, mode: 'fixed', period: 'daily', fixed_qty: 2,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a family_band-mode rule with bands', () => {
    const result = createDistributionRuleSchema.safeParse({
      item_id: itemId, mode: 'family_band', period: 'weekly',
      bands: [{ min: 1, max: 2, qty: 5 }, { min: 3, max: 6, qty: 10 }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts priority addons and eligibility tags', () => {
    const result = createDistributionRuleSchema.safeParse({
      item_id: itemId, mode: 'fixed', period: 'once', fixed_qty: 1,
      priority_addons: [{ when: 'has_pregnant', extra_qty: 2 }],
      eligibility: ['has_child'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid mode', () => {
    const result = createDistributionRuleSchema.safeParse({ item_id: itemId, mode: 'nonsense', period: 'daily' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown eligibility tag', () => {
    const result = createDistributionRuleSchema.safeParse({
      item_id: itemId, mode: 'fixed', period: 'daily', fixed_qty: 1, eligibility: ['has_pets'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a camp-specific rule, keyed by camp_id', () => {
    const result = createDistributionRuleSchema.safeParse({
      item_id: itemId, camp_id: campId, mode: 'fixed', period: 'daily', fixed_qty: 3,
    });
    expect(result.success).toBe(true);
    expect(result.data.camp_id).toBe(campId);
  });

  it('leaves camp_id unset for a global rule', () => {
    const result = createDistributionRuleSchema.safeParse({
      item_id: itemId, mode: 'fixed', period: 'daily', fixed_qty: 3,
    });
    expect(result.success).toBe(true);
    expect(result.data.camp_id).toBeUndefined();
  });
});

describe('updateDistributionRuleSchema', () => {
  it('accepts a partial update touching only the quantity', () => {
    const result = updateDistributionRuleSchema.safeParse({ fixed_qty: 4 });
    expect(result.success).toBe(true);
  });

  it('accepts moving a rule onto a different camp', () => {
    const result = updateDistributionRuleSchema.safeParse({ camp_id: campId });
    expect(result.success).toBe(true);
  });

  it('accepts deactivating a rule', () => {
    const result = updateDistributionRuleSchema.safeParse({ active: false });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid mode even on a partial update', () => {
    const result = updateDistributionRuleSchema.safeParse({ mode: 'nonsense' });
    expect(result.success).toBe(false);
  });
});

describe('distributeItemSchema', () => {
  it('accepts a distribution without an override', () => {
    expect(distributeItemSchema.safeParse({ beneficiary_id: beneficiaryId, item_id: itemId }).success).toBe(true);
  });

  it('accepts an override reason', () => {
    const result = distributeItemSchema.safeParse({
      beneficiary_id: beneficiaryId, item_id: itemId, override_reason: 'Family arrived injured.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty override reason', () => {
    const result = distributeItemSchema.safeParse({
      beneficiary_id: beneficiaryId, item_id: itemId, override_reason: '',
    });
    expect(result.success).toBe(false);
  });
});
