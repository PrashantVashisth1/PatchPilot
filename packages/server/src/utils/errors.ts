// ---------------------------------------------------------------------------
// PatchPilot server — standardized error types
// ---------------------------------------------------------------------------

/**
 * Application-level error with an HTTP status code and machine-readable code.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(message, 400, "BAD_REQUEST", details);
}

export function notFound(message: string): AppError {
  return new AppError(message, 404, "NOT_FOUND");
}

export function unprocessable(message: string, code: string, details?: unknown): AppError {
  return new AppError(message, 422, code, details);
}

export function internalError(message: string, details?: unknown): AppError {
  return new AppError(message, 500, "INTERNAL_ERROR", details);
}