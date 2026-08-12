import * as authService from './auth.service.js';
import { REFRESH_TOKEN_TTL_MS } from '../../core/tokens.js';
import { isProd } from '../../config/env.js';

export const REFRESH_COOKIE = 'refresh_token';

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,      // javascript cannot read it, so XSS cannot steal it
    sameSite: 'strict',  // not sent cross-site, so CSRF cannot use it
    secure: isProd,      // HTTPS only in production
    path: '/api/auth',   // sent only to auth endpoints
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

export async function signupHandler(req, res) {
  const { user } = await authService.signup(req.body, { ip: req.ip });
  res.status(201).json({ user: user.toSafeJSON() });
}

export async function loginHandler(req, res) {
  const { user, access_token, refresh_token } = await authService.login(req.body, { ip: req.ip });
  setRefreshCookie(res, refresh_token);
  res.json({ user: user.toSafeJSON(), access_token });
}

export async function refreshHandler(req, res) {
  const { user, access_token, refresh_token } = await authService.rotateRefreshToken(
    req.cookies?.[REFRESH_COOKIE]
  );
  setRefreshCookie(res, refresh_token);
  res.json({ user: user.toSafeJSON(), access_token });
}

export async function meHandler(req, res) {
  res.json({ user: req.user.doc.toSafeJSON() });
}

export async function logoutHandler(req, res) {
  await authService.revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.status(204).send();
}
