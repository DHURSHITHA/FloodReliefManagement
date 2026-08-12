import { verifyAccessToken } from '../core/tokens.js';
import { AppError, ERROR_CODES } from '../core/errors.js';
import { User } from '../modules/auth/user.model.js';

/**
 * Verify the bearer token and load the user.
 *
 * The database lookup is deliberate. A 15-minute access token issued before an
 * account was disabled would otherwise keep working until it expired; checking
 * status on each request means revocation takes effect immediately.
 */
export async function authenticate(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(AppError.unauthenticated('Sign in to continue.'));
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const expired = err?.name === 'TokenExpiredError';
    return next(
      new AppError(
        401,
        expired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.TOKEN_INVALID,
        expired ? 'Your session has expired.' : 'Invalid session.'
      )
    );
  }

  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') {
    return next(AppError.unauthenticated('This account is no longer active.'));
  }

  req.user = {
    id: user._id.toString(),
    role: user.role,
    camp_id: user.assigned_camp_id ? user.assigned_camp_id.toString() : null,
    doc: user,
  };
  next();
}
