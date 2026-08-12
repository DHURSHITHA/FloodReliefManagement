import { describe, it, expect } from 'vitest';
import { hashAadhaar, encryptAadhaar, decryptAadhaar } from './crypto.js';

describe('hashAadhaar', () => {
  it('is deterministic for the same input', () => {
    expect(hashAadhaar('234567890123')).toBe(hashAadhaar('234567890123'));
  });

  it('differs for different inputs', () => {
    expect(hashAadhaar('234567890123')).not.toBe(hashAadhaar('234567890124'));
  });

  it('never contains the plaintext number', () => {
    expect(hashAadhaar('234567890123')).not.toContain('234567890123');
  });
});

describe('encryptAadhaar / decryptAadhaar', () => {
  it('round-trips to the original value', () => {
    const enc = encryptAadhaar('234567890123');
    expect(decryptAadhaar(enc)).toBe('234567890123');
  });

  it('produces a different ciphertext each call (random IV) but still decrypts correctly', () => {
    const a = encryptAadhaar('234567890123');
    const b = encryptAadhaar('234567890123');
    expect(a).not.toBe(b);
    expect(decryptAadhaar(a)).toBe('234567890123');
    expect(decryptAadhaar(b)).toBe('234567890123');
  });

  it('never contains the plaintext number', () => {
    expect(encryptAadhaar('234567890123')).not.toContain('234567890123');
  });
});
