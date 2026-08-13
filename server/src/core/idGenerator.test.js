import { describe, it, expect, beforeEach } from 'vitest';
import { nextBeneficiaryCode, nextSosCode, nextDonationCode } from './idGenerator.js';
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

describe('nextSosCode', () => {
  beforeEach(async () => { await clearDatabase(); });

  it('starts at SOS-1001', async () => {
    expect(await nextSosCode()).toBe('SOS-1001');
  });

  it('increments independently of the beneficiary counter', async () => {
    await nextBeneficiaryCode();
    expect(await nextSosCode()).toBe('SOS-1001');
  });

  it('never issues the same code twice under concurrent calls', async () => {
    const codes = await Promise.all(Array.from({ length: 10 }, () => nextSosCode()));
    expect(new Set(codes).size).toBe(10);
  });
});

describe('nextDonationCode', () => {
  beforeEach(async () => { await clearDatabase(); });

  it('starts at DON-1001', async () => {
    expect(await nextDonationCode()).toBe('DON-1001');
  });

  it('increments independently of the other counters', async () => {
    await nextBeneficiaryCode();
    await nextSosCode();
    expect(await nextDonationCode()).toBe('DON-1001');
  });

  it('never issues the same code twice under concurrent calls', async () => {
    const codes = await Promise.all(Array.from({ length: 10 }, () => nextDonationCode()));
    expect(new Set(codes).size).toBe(10);
  });
});
