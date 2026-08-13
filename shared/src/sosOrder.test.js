import { describe, it, expect } from 'vitest';
import { urgencyRank, bySosPriority } from './sosOrder.js';

describe('urgencyRank', () => {
  it('ranks critical as most urgent', () => {
    expect(urgencyRank('critical')).toBeLessThan(urgencyRank('high'));
    expect(urgencyRank('high')).toBeLessThan(urgencyRank('medium'));
    expect(urgencyRank('medium')).toBeLessThan(urgencyRank('low'));
  });
});

describe('bySosPriority', () => {
  const at = (isoOffset) => new Date(Date.now() + isoOffset).toISOString();

  it('puts still-open work before closed work regardless of urgency', () => {
    const closed = { status: 'resolved', urgency: 'critical', createdAt: at(0) };
    const open = { status: 'open', urgency: 'low', createdAt: at(0) };
    expect([closed, open].sort(bySosPriority)).toEqual([open, closed]);
  });

  it('orders open work by urgency, most urgent first', () => {
    const low = { status: 'open', urgency: 'low', createdAt: at(0) };
    const critical = { status: 'open', urgency: 'critical', createdAt: at(1) };
    const medium = { status: 'open', urgency: 'medium', createdAt: at(2) };
    expect([low, critical, medium].sort(bySosPriority)).toEqual([critical, medium, low]);
  });

  it('breaks ties within the same urgency by newest first', () => {
    const older = { status: 'open', urgency: 'high', createdAt: at(0) };
    const newer = { status: 'open', urgency: 'high', createdAt: at(1000) };
    expect([older, newer].sort(bySosPriority)).toEqual([newer, older]);
  });
});
