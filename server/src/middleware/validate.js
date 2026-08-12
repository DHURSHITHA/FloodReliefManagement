import { AppError } from '../core/errors.js';

/**
 * Validate and REPLACE req[source] with the parsed result, so downstream code
 * only ever sees coerced, trimmed, known-good data.
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        AppError.badRequest(
          'Please correct the highlighted fields.',
          result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
        )
      );
    }
    req[source] = result.data;
    next();
  };
}
