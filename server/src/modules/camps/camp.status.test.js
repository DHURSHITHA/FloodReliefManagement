import { describe, it, expect } from 'vitest';
import { deriveCampStatus } from './camp.status.js';

describe('deriveCampStatus', () => {
  it('is open below the nearly-full threshold', () => {
    expect(deriveCampStatus({ beneficiaries_accepted: 50, beneficiary_capacity: 100 })).toBe('open');
  });

  it('is nearly_full at or above 85% occupancy', () => {
    expect(deriveCampStatus({ beneficiaries_accepted: 85, beneficiary_capacity: 100 })).toBe('nearly_full');
    expect(deriveCampStatus({ beneficiaries_accepted: 84, beneficiary_capacity: 100 })).toBe('open');
  });

  it('is full at or above capacity', () => {
    expect(deriveCampStatus({ beneficiaries_accepted: 100, beneficiary_capacity: 100 })).toBe('full');
    expect(deriveCampStatus({ beneficiaries_accepted: 105, beneficiary_capacity: 100 })).toBe('full');
  });

  it('treats zero capacity as full rather than dividing by zero', () => {
    expect(deriveCampStatus({ beneficiaries_accepted: 0, beneficiary_capacity: 0 })).toBe('full');
  });

  it('an admin override always wins over the computed value', () => {
    expect(deriveCampStatus({ beneficiaries_accepted: 0, beneficiary_capacity: 100, admin_override: 'temporarily_closed' })).toBe('temporarily_closed');
    expect(deriveCampStatus({ beneficiaries_accepted: 100, beneficiary_capacity: 100, admin_override: 'closed' })).toBe('closed');
  });
});
