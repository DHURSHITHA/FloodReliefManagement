import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      camp_ids: (user.assigned_camp_ids ?? []).map((id) => id.toString()),
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

/** Opaque, high-entropy refresh token. Not a JWT: it must be revocable. */
export function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

/**
 * Hash before storing. A leaked database dump then contains no usable session.
 * SHA-256 is right here, unlike for passwords: the token already has 384 bits
 * of entropy, so there is nothing to brute-force and no need to be slow.
 */
export function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
