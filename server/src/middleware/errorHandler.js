import { AppError, ERROR_CODES } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { isProd } from '../config/env.js';

export function notFoundHandler(req, res, next) {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} does not exist.`));
}

// Express identifies error middleware by arity, so `next` must stay declared.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err }, 'expected server error');
    return res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, details: err.details } });
  }

  // Mongoose duplicate key — surfaced as a conflict, never as a 500.
  if (err?.code === 11000) {
    return res.status(409).json({
      error: {
        code: ERROR_CODES.CONFLICT,
        message: 'That record already exists.',
        details: Object.keys(err.keyPattern ?? {}).map((path) => ({
          path,
          message: 'already in use',
        })),
      },
    });
  }

  logger.error({ err }, 'unhandled error');
  return res.status(500).json({
    error: {
      code: ERROR_CODES.INTERNAL,
      // Never expose internals in production.
      message: isProd ? 'An unexpected error occurred.' : String(err?.message ?? err),
      details: [],
    },
  });
}
