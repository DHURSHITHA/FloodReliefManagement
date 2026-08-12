import { describe, it, expect } from 'vitest';
import { calcRation, computePeriodKey } from './distribution.js';

const member = (over = {}) => ({ is_pregnant: false, has_disability: false, priority_tags: [], ...over });

describe('calcRation', () => {
  it('returns a fixed quantity regardless of family size', () => {
    const rule = { active: true, mode: 'fixed', fixed_qty: 2 };
    expect(calcRation(rule, [member(), member(), member()])).toBe(2);
  });

  it('multiplies per-head quantity by family size', () => {
    const rule = { active: true, mode: 'per_head', per_head_qty: 0.5 };
    expect(calcRation(rule, [member(), member()])).toBe(1);
  });

  it('picks the matching family band', () => {
    const rule = {
      active: true, mode: 'family_band',
      bands: [{ min: 1, max: 2, qty: 5 }, { min: 3, max: 5, qty: 10 }],
    };
    expect(calcRation(rule, [member(), member(), member()])).toBe(10);
  });

  it('returns 0 for a family size outside every band', () => {
    const rule = { active: true, mode: 'family_band', bands: [{ min: 1, max: 2, qty: 5 }] };
    expect(calcRation(rule, [member(), member(), member()])).toBe(0);
  });

  it('adds a priority addon when a matching member is present', () => {
    const rule = {
      active: true, mode: 'fixed', fixed_qty: 2,
      priority_addons: [{ when: 'has_pregnant', extra_qty: 1 }],
    };
    expect(calcRation(rule, [member({ is_pregnant: true })])).toBe(3);
  });

  it('does not add an addon when no member matches', () => {
    const rule = {
      active: true, mode: 'fixed', fixed_qty: 2,
      priority_addons: [{ when: 'has_pregnant', extra_qty: 1 }],
    };
    expect(calcRation(rule, [member()])).toBe(2);
  });

  it('reads child and senior tags from priority_tags', () => {
    const rule = {
      active: true, mode: 'fixed', fixed_qty: 1,
      priority_addons: [{ when: 'has_child', extra_qty: 4 }],
    };
    expect(calcRation(rule, [member({ priority_tags: ['child'] })])).toBe(5);
  });

  it('clamps to min_qty and max_qty', () => {
    const low = { active: true, mode: 'fixed', fixed_qty: 1, min_qty: 3 };
    expect(calcRation(low, [member()])).toBe(3);
    const high = { active: true, mode: 'fixed', fixed_qty: 100, max_qty: 10 };
    expect(calcRation(high, [member()])).toBe(10);
  });

  it('returns 0 when eligibility requires a tag no member has', () => {
    const rule = { active: true, mode: 'fixed', fixed_qty: 5, eligibility: ['has_child'] };
    expect(calcRation(rule, [member()])).toBe(0);
  });

  it('returns the quantity when at least one member satisfies eligibility', () => {
    const rule = { active: true, mode: 'fixed', fixed_qty: 5, eligibility: ['has_child'] };
    expect(calcRation(rule, [member(), member({ priority_tags: ['child'] })])).toBe(5);
  });

  it('returns 0 for an inactive rule', () => {
    const rule = { active: false, mode: 'fixed', fixed_qty: 5 };
    expect(calcRation(rule, [member()])).toBe(0);
  });

  it('returns 0 when no rule is given', () => {
    expect(calcRation(null, [member()])).toBe(0);
  });
});

describe('computePeriodKey', () => {
  it('returns "once" for a one-time rule regardless of date', () => {
    expect(computePeriodKey('once', new Date('2026-08-12'))).toBe('once');
  });

  it('returns an ISO date for a daily rule', () => {
    expect(computePeriodKey('daily', new Date('2026-08-12T15:00:00Z'))).toBe('2026-08-12');
  });

  it('returns the same key for two daily distributions on the same day', () => {
    const a = computePeriodKey('daily', new Date('2026-08-12T01:00:00Z'));
    const b = computePeriodKey('daily', new Date('2026-08-12T23:00:00Z'));
    expect(a).toBe(b);
  });

  it('returns a different key on the next day', () => {
    const a = computePeriodKey('daily', new Date('2026-08-12T23:00:00Z'));
    const b = computePeriodKey('daily', new Date('2026-08-13T01:00:00Z'));
    expect(a).not.toBe(b);
  });

  it('returns an ISO week key for a weekly rule', () => {
    expect(computePeriodKey('weekly', new Date('2026-08-12T00:00:00Z'))).toMatch(/^2026-W\d{2}$/);
  });

  it('returns the same week key for two days in the same ISO week', () => {
    const mon = computePeriodKey('weekly', new Date('2026-08-10T00:00:00Z'));
    const wed = computePeriodKey('weekly', new Date('2026-08-12T00:00:00Z'));
    expect(mon).toBe(wed);
  });

  it('throws on an unknown period', () => {
    expect(() => computePeriodKey('fortnightly')).toThrow();
  });
});
