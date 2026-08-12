import { AppError } from '../core/errors.js';

/**
 * Validate req[source] and expose the coerced, known-good result to
 * downstream code. `req.query` is a getter-only accessor in Express 5 (it
 * re-parses the URL on every read, so neither `req.query = ...` nor
 * mutating it in place sticks) — for source 'query' the parsed result goes
 * on `req.validatedQuery` instead. `body` and `params` are plain, writable
 * properties, so those are replaced directly as before.
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
    if (source === 'query') {
      req.validatedQuery = result.data;
    } else {
      req[source] = result.data;
    }
    next();
  };
}
