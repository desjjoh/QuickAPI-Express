/**
 * @fileoverview HTTP error utilities for consistent API error handling.
 * @module core/utils/http-error
 * @description
 *  Defines custom error classes extending the native `Error` object to provide
 *  standardized HTTP status codes and optional error codes for API responses.
 *  Used across middleware, services, and controllers to represent intentional
 *  application-level failures.
 *
 * @remarks
 *  - Each error includes an HTTP `status` and human-readable `message`.
 *  - Supports optional `code` identifiers for fine-grained error tracking.
 *  - Intended to be caught by centralized error-handling middleware.
 *
 * @example
 *  import { NotFoundError } from '@/core/utils/http-error';
 *  throw new NotFoundError('User not found');
 */

/**
 * Base class for all HTTP-related errors.
 * Extends the built-in `Error` class with an HTTP status code and optional code identifier.
 */
export class HttpError extends Error {
  /** HTTP status code associated with the error (e.g., 400, 404, 500). */
  public status: number;

  /** Optional machine-readable error code for application-level categorization. */
  public code?: string;

  /**
   * Constructs a new HTTP error instance.
   *
   * @param status - The HTTP status code.
   * @param message - The human-readable error message.
   * @param code - Optional internal error code or identifier.
   *
   * @example
   *  throw new HttpError(403, 'Forbidden', 'ACCESS_DENIED');
   */
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Represents an HTTP 404 "Not Found" error.
 * Used when a requested resource does not exist.
 */
export class NotFoundError extends HttpError {
  /**
   * Constructs a new NotFoundError.
   *
   * @param message - Optional custom message (default: `"Not Found"`).
   *
   * @example
   *  throw new NotFoundError('User not found');
   */
  constructor(message = 'Not Found') {
    super(404, message);
  }
}

/**
 * Represents an HTTP 400 "Bad Request" error.
 * Used when input validation fails or a malformed request is received.
 */
export class BadRequestError extends HttpError {
  /**
   * Constructs a new BadRequestError.
   *
   * @param message - Optional custom message (default: `"Bad Request"`).
   *
   * @example
   *  throw new BadRequestError('Missing required field: email');
   */
  constructor(message = 'Bad Request') {
    super(400, message);
  }
}
