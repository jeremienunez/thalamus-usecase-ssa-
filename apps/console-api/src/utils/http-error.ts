/**
 * Unified error contract for controller/service boundaries.
 *
 * Services throw `HttpError` instead of returning discriminated unions with
 * sentinel strings / `{error, code}` payloads. `asyncHandler` already reads
 * `.statusCode` off thrown errors and maps them to the reply, so no wrapper
 * changes are needed at the controller side — just let the error propagate.
 */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }

  static badRequest(msg: string): HttpError {
    return new HttpError(400, msg);
  }

  static notFound(msg: string): HttpError {
    return new HttpError(404, msg);
  }

  static conflict(msg: string): HttpError {
    return new HttpError(409, msg);
  }

  /**
   * Emit an explicit 500 carrying a caller-controlled message.
   *
   * ⚠ The message will be serialized to the client AS-IS, even in production.
   * `asyncHandler` only redacts 500s that originate from *uncaught* errors
   * (no `statusCode` set). An `HttpError` with `statusCode=500` is considered
   * intentionally-surfaced by the developer and bypasses redaction.
   *
   * Use only for operator-facing diagnostics you would paste into a bug
   * report. For anything involving raw DB errors, `pg` strings, or internal
   * stack traces, let the error propagate uncaught and let `asyncHandler`
   * redact it to `"internal error"`.
   */
  static internal(msg: string): HttpError {
    return new HttpError(500, msg);
  }
}
