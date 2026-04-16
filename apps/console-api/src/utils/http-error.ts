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

  static internal(msg: string): HttpError {
    return new HttpError(500, msg);
  }
}
