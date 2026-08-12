import { describe, it, expect } from 'vitest';
import { priorityRank, byServiceOrder } from './priorityOrder.js';

describe('priorityRank', () => {
  it('serves pregnant, then senior, then child', () => {
    expect(priorityRank(['pregnant'])).toBeLessThan(priorityRank(['senior_citizen']));
    expect(priorityRank(['senior_citizen'])).toBeLessThan(priorityRank(['child']));
  });

  it('ranks an untagged person after everyone tagged', () => {
    expect(priorityRank([])).toBeGreaterThan(priorityRank(['disability']));
  });

  it('takes the most urgent tag, never the sum', () => {
    // A pregnant woman who also has a disability is served as pregnant.
    expect(priorityRank(['pregnant', 'disability'])).toBe(priorityRank(['pregnant']));
  });
});

describe('byServiceOrder', () => {
  it('puts the queue in pregnant, senior, child, disability, everyone-else order', () => {
    const people = [
      { name: 'Untagged', age: 30, priority_tags: [] },
      { name: 'Child', age: 8, priority_tags: ['child'] },
      { name: 'Pregnant', age: 28, priority_tags: ['pregnant'] },
      { name: 'Disabled', age: 40, priority_tags: ['disability'] },
      { name: 'Senior', age: 71, priority_tags: ['senior_citizen'] },
    ];
    expect([...people].sort(byServiceOrder).map((p) => p.name))
      .toEqual(['Pregnant', 'Senior', 'Child', 'Disabled', 'Untagged']);
  });

  it('breaks ties on age, oldest first', () => {
    const seniors = [
      { name: 'Younger', age: 62, priority_tags: ['senior_citizen'] },
      { name: 'Older', age: 84, priority_tags: ['senior_citizen'] },
    ];
    expect([...seniors].sort(byServiceOrder).map((p) => p.name)).toEqual(['Older', 'Younger']);
  });
});
