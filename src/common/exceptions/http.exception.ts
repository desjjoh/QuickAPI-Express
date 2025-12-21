import { formatBytes } from '@/common/helpers/string.helpers';
import type { z } from 'zod';

export class HttpError extends Error {
  public status: number;
  public code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad Request') {
    super(400, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(403, message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not Found') {
    super(404, message);
  }
}

export class MethodNotAllowedError extends HttpError {
  constructor(method: string, message?: string) {
    super(405, message ?? `HTTP method '${method}' is not allowed on this server.`);
  }
}

export class RequestTimeoutError extends HttpError {
  constructor(message = 'Request timeout.') {
    super(408, message);
  }
}

export class RequestBodyTooLargeError extends HttpError {
  constructor(limitBytes: number) {
    super(413, `Request body exceeds maximum allowed size (limit = ${formatBytes(limitBytes)}).`);
  }
}

export class UnsupportedMediaTypeError extends HttpError {
  constructor(message = 'Unsupported Media Type') {
    super(415, message);
  }
}

export class ValidationError extends HttpError {
  constructor(message: string) {
    super(422, message);
  }
}

export class RateLimitError extends HttpError {
  constructor(message: string) {
    super(429, message);
  }
}

export class RequestHeaderFieldsTooLargeError extends HttpError {
  constructor(message: string) {
    super(431, message);
  }
}

export class OutputValidationError extends HttpError {
  public issues: z.core.$ZodIssue[];

  constructor(message: string, issues: z.core.$ZodIssue[]) {
    super(500, message, 'Output Validation Error');
    this.issues = issues;
  }
}

export class UnsupportedTransferEncodingError extends HttpError {
  constructor(message = 'Unsupported Transfer-Encoding.') {
    super(501, message);
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message = 'Service Unavailable') {
    super(503, message);
  }
}
