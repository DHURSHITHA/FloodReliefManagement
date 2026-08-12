import { describe, it, expect } from 'vitest';
import { verhoeffCheckDigit, isValidAadhaar, maskAadhaar } from './aadhaar.js';

describe('isValidAadhaar', () => {
  // Property: for any 11-digit prefix exactly one check digit is valid.
  // This proves the checksum without relying on a hardcoded magic number.
  const prefix = '23456789012';

  it('accepts a number whose check digit is correct', () => {
    const cd = verhoeffCheckDigit(prefix);
    expect(isValidAadhaar(prefix + cd)).toBe(true);
  });

  it('rejects every other check digit for the same prefix', () => {
    const cd = verhoeffCheckDigit(prefix);
    for (let d = 0; d <= 9; d++) {
      if (d === cd) continue;
      expect(isValidAadhaar(prefix + d)).toBe(false);
    }
  });

  it('detects any single-digit typo', () => {
    const valid = prefix + verhoeffCheckDigit(prefix);
    for (let pos = 1; pos < 12; pos++) {
      for (let d = 0; d <= 9; d++) {
        if (Number(valid[pos]) === d) continue;
        const typo = valid.slice(0, pos) + d + valid.slice(pos + 1);
        expect(isValidAadhaar(typo)).toBe(false);
      }
    }
  });

  it('rejects wrong lengths and non-digits', () => {
    expect(isValidAadhaar('12345')).toBe(false);
    expect(isValidAadhaar('2345678901234')).toBe(false);
    expect(isValidAadhaar('23456789O12X')).toBe(false);
    expect(isValidAadhaar('')).toBe(false);
    expect(isValidAadhaar(null)).toBe(false);
    expect(isValidAadhaar(234567890124)).toBe(false);
  });

  it('rejects numbers starting with 0 or 1, which UIDAI never issues', () => {
    const zero = '0' + prefix.slice(1);
    const one = '1' + prefix.slice(1);
    expect(isValidAadhaar(zero + verhoeffCheckDigit(zero))).toBe(false);
    expect(isValidAadhaar(one + verhoeffCheckDigit(one))).toBe(false);
  });

  it('tolerates spaces and hyphens in user input', () => {
    const valid = prefix + verhoeffCheckDigit(prefix);
    const spaced = `${valid.slice(0, 4)} ${valid.slice(4, 8)} ${valid.slice(8)}`;
    expect(isValidAadhaar(spaced)).toBe(true);
    expect(isValidAadhaar(spaced.replaceAll(' ', '-'))).toBe(true);
  });
});

describe('maskAadhaar', () => {
  it('reveals only the last four digits', () => {
    expect(maskAadhaar('234567890124')).toBe('XXXX XXXX 0124');
  });
});
