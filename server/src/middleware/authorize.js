import { AppError } from '../core/errors.js';

/** Allow only the listed roles. 403, not 401: the caller is known, just not permitted. */
export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthenticated());
    if (!roles.includes(req.user.role)) {
      return next(AppError.forbidden('Your role does not have access to this action.'));
    }
    next();
  };
}

/**
 * Restrict a camp official to their own assigned camp.
 *
 * This is the check a frontend guard cannot make. The browser can hide a
 * button; only the server can refuse the request behind it. Admins are
 * unrestricted by design — requirements §4 gives them full administration.
 *
 * @param {(req) => string|null} getCampId reads the target camp id from the request
 */
export function requireOwnCamp(getCampId) {
  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthenticated());
    if (req.user.role === 'admin') return next();

    const target = getCampId(req);
    if (!target) return next(AppError.badRequest('A camp must be specified.'));

    if (!req.user.camp_id || req.user.camp_id !== String(target)) {
      return next(AppError.forbidden('You may only act on the camp you are assigned to.'));
    }
    next();
  };
}
