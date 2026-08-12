import { describe, it, expect } from 'vitest';
import { isLowStock, isNearExpiry, isExpired } from './inventory.js';

describe('isLowStock', () => {
  it('is true when remaining is at or below the threshold', () => {
    expect(isLowStock({ remaining_qty: 5, reorder_threshold: 5 })).toBe(true);
    expect(isLowStock({ remaining_qty: 4, reorder_threshold: 5 })).toBe(true);
  });

  it('is false above the threshold', () => {
    expect(isLowStock({ remaining_qty: 6, reorder_threshold: 5 })).toBe(false);
  });
});

describe('isNearExpiry', () => {
  const now = new Date('2026-08-12T00:00:00Z');

  it('is true within the default 7-day window', () => {
    expect(isNearExpiry('2026-08-15T00:00:00Z', 7, now)).toBe(true);
  });

  it('is false outside the window', () => {
    expect(isNearExpiry('2026-09-01T00:00:00Z', 7, now)).toBe(false);
  });

  it('is false when there is no expiry date', () => {
    expect(isNearExpiry(null, 7, now)).toBe(false);
  });
});

describe('isExpired', () => {
  const now = new Date('2026-08-12T00:00:00Z');

  it('is true for a past expiry date', () => {
    expect(isExpired('2026-08-01T00:00:00Z', now)).toBe(true);
  });

  it('is false for a future expiry date', () => {
    expect(isExpired('2026-09-01T00:00:00Z', now)).toBe(false);
  });

  it('is false when there is no expiry date', () => {
    expect(isExpired(null, now)).toBe(false);
  });
});
