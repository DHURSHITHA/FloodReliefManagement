export const ERROR_CODES = Object.freeze({
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ACCOUNT_PENDING_APPROVAL: 'ACCOUNT_PENDING_APPROVAL',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
});

export class AppError extends Error {
  /**
   * @param {number} status  HTTP status
   * @param {string} code    a value from ERROR_CODES
   * @param {string} message safe for display to an end user
   * @param {Array<{path:string,message:string}>} details field-level errors
   */
  constructor(status, code, message, details = []) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expected = true; // distinguishes deliberate errors from crashes
  }

  static badRequest(message, details = []) {
    return new AppError(400, ERROR_CODES.VALIDATION_FAILED, message, details);
  }
  static unauthenticated(message = 'Authentication required.') {
    return new AppError(401, ERROR_CODES.UNAUTHENTICATED, message);
  }
  static forbidden(message = 'You do not have permission to perform this action.') {
    return new AppError(403, ERROR_CODES.FORBIDDEN, message);
  }
  static notFound(message = 'Not found.') {
    return new AppError(404, ERROR_CODES.NOT_FOUND, message);
  }
  static conflict(code, message, details = []) {
    return new AppError(409, code, message, details);
  }
}
