import { describe, it, expect, beforeEach } from 'vitest';
import { nextBeneficiaryCode } from './idGenerator.js';
import { clearDatabase } from '../test/helpers.js';

describe('nextBeneficiaryCode', () => {
  beforeEach(async () => { await clearDatabase(); });

  it('starts at BEN-1001', async () => {
    expect(await nextBeneficiaryCode()).toBe('BEN-1001');
  });

  it('increments on each call', async () => {
    await nextBeneficiaryCode();
    expect(await nextBeneficiaryCode()).toBe('BEN-1002');
  });

  it('never issues the same code twice under concurrent calls', async () => {
    const codes = await Promise.all(Array.from({ length: 10 }, () => nextBeneficiaryCode()));
    expect(new Set(codes).size).toBe(10);
  });
});
