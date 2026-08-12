import { describe, it, expect } from 'vitest';
import { derivePriority } from './priority.js';

const person = (over = {}) => ({ age: 30, is_pregnant: false, has_disability: false, ...over });

describe('derivePriority', () => {
  it('classifies an ordinary adult as normal with no tags', () => {
    expect(derivePriority(person())).toEqual({ priority_tags: [], priority_level: 'normal' });
  });

  it('classifies age 60 and above as senior_citizen', () => {
    expect(derivePriority(person({ age: 60 })).priority_tags).toEqual(['senior_citizen']);
    expect(derivePriority(person({ age: 85 })).priority_level).toBe('high');
    expect(derivePriority(person({ age: 59 })).priority_tags).toEqual([]);
  });

  it('classifies age 12 and below as child', () => {
    expect(derivePriority(person({ age: 12 })).priority_tags).toEqual(['child']);
    expect(derivePriority(person({ age: 0 })).priority_level).toBe('high');
    expect(derivePriority(person({ age: 13 })).priority_tags).toEqual([]);
  });

  it('classifies pregnancy and disability', () => {
    expect(derivePriority(person({ is_pregnant: true })).priority_tags).toEqual(['pregnant']);
    expect(derivePriority(person({ has_disability: true })).priority_tags).toEqual(['disability']);
  });

  it('accumulates every applicable tag', () => {
    const r = derivePriority(person({ age: 70, has_disability: true }));
    expect(r.priority_tags).toEqual(['senior_citizen', 'disability']);
    expect(r.priority_level).toBe('high');
  });

  it('returns tags in a stable order regardless of input order', () => {
    const a = derivePriority({ has_disability: true, is_pregnant: true, age: 8 });
    expect(a.priority_tags).toEqual(['child', 'pregnant', 'disability']);
  });

  it('treats a missing or invalid age as normal rather than throwing', () => {
    expect(derivePriority({ age: undefined }).priority_level).toBe('normal');
    expect(derivePriority({}).priority_level).toBe('normal');
  });
});
