import crypto from 'node:crypto';
import { env } from '../config/env.js';

const pepper = Buffer.from(env.AADHAAR_HMAC_PEPPER, 'hex');
const encKey = Buffer.from(env.AADHAAR_ENC_KEY, 'hex'); // 32 bytes → AES-256

/** Deterministic HMAC — same input always hashes the same, so a unique index
 * on this value works exactly like a unique index on the plaintext would,
 * without ever storing the plaintext (spec section 2.1). */
export function hashAadhaar(aadhaar) {
  return crypto.createHmac('sha256', pepper).update(String(aadhaar)).digest('hex');
}

/** AES-256-GCM, for lawful retrieval only. IV + auth tag + ciphertext are
 * packed together so decryptAadhaar needs nothing but this one string. */
export function encryptAadhaar(aadhaar) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(aadhaar), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptAadhaar(enc) {
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
