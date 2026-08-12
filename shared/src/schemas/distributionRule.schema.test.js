import { describe, it, expect } from 'vitest';
import { createDistributionRuleSchema, distributeItemSchema } from './distributionRule.schema.js';

const itemId = '507f1f77bcf86cd799439012';
const beneficiaryId = '507f1f77bcf86cd799439013';

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
