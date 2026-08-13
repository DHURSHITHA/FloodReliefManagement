import { describe, it, expect } from 'vitest';
import { createDonationSchema, donationDecisionSchema, DONATION_TYPES } from './donation.schema.js';

const validFinancial = { donation_type: 'financial', amount: 5000, payment_method: 'UPI' };
const validMaterial = {
  donation_type: 'material',
  materials: [{ resource_item_id: '64b64b64b64b64b64b64b64b', quantity: 100, unit: 'kg' }],
};

describe('createDonationSchema', () => {
  it('names both §6.13 donation types', () => {
    expect(DONATION_TYPES).toEqual(['financial', 'material']);
  });

  it('accepts a well-formed financial donation', () => {
    expect(createDonationSchema.safeParse(validFinancial).success).toBe(true);
  });

  it('accepts a well-formed material donation', () => {
    expect(createDonationSchema.safeParse(validMaterial).success).toBe(true);
  });

  it('requires an amount for a financial donation', () => {
    const { amount, ...rest } = validFinancial;
    expect(createDonationSchema.safeParse(rest).success).toBe(false);
  });

  it('requires a payment method for a financial donation', () => {
    const { payment_method, ...rest } = validFinancial;
    expect(createDonationSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a financial donation carrying material items', () => {
    const result = createDonationSchema.safeParse({ ...validFinancial, materials: validMaterial.materials });
    expect(result.success).toBe(false);
  });

  it('requires at least one item for a material donation', () => {
    const result = createDonationSchema.safeParse({ donation_type: 'material', materials: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a material donation carrying an amount', () => {
    const result = createDonationSchema.safeParse({ ...validMaterial, amount: 500 });
    expect(result.success).toBe(false);
  });

  it('does not require a target camp at creation — that is a confirmation-time rule', () => {
    expect(createDonationSchema.safeParse(validMaterial).success).toBe(true);
  });

  it('rejects a non-positive quantity on a material item', () => {
    const result = createDonationSchema.safeParse({
      donation_type: 'material',
      materials: [{ ...validMaterial.materials[0], quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('donationDecisionSchema', () => {
  it('accepts confirming with no reason', () => {
    expect(donationDecisionSchema.safeParse({ action: 'confirm' }).success).toBe(true);
  });

  it('requires a reason to reject', () => {
    const result = donationDecisionSchema.safeParse({ action: 'reject' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['rejection_reason']);
  });

  it('accepts rejecting with a reason', () => {
    const result = donationDecisionSchema.safeParse({ action: 'reject', rejection_reason: 'Duplicate entry.' });
    expect(result.success).toBe(true);
  });
});
