// One error type for the whole core; the Local API maps `code` to the SRS 11 envelope.
export const HTTP_STATUS = Object.freeze({
  VALIDATION: 400,
  AUTH: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_LARGE: 413,
  UNSUPPORTED_TYPE: 415,
  LOCKED: 423,
  SEND_FAILED: 502,
  INTERNAL: 500,
});

export class AppError extends Error {
  /**
   * @param {keyof typeof HTTP_STATUS | string} code
   * @param {{message?: string, detail?: string, retryAfterSeconds?: number}} [opts]
   *   `detail` is a more specific machine code (e.g. RECIPIENT_OFFLINE) under a 409/502 status.
   */
  constructor(code, { message = 'Request failed.', detail, retryAfterSeconds } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
    this.retryAfterSeconds = retryAfterSeconds;
    this.status = HTTP_STATUS[code] ?? 500;
  }
}
