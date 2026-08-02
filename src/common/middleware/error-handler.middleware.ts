import type { ErrorRequestHandler } from 'express';
import z, { ZodError } from 'zod';

import type { Request, Response, NextFunction } from 'express';

import { logger } from '@/config/logger.config';
import { HttpError } from '@/common/exceptions/http.exception';
import { toErrorDTO } from '@/common/library/models/exception.model';
import { RequestContext } from '@/common/store/request-context.store';

const INTERNAL_SERVER_ERROR = 'Internal Server Error';
const MALFORMED_JSON_ERROR = 'Malformed JSON request body.';

function isMalformedJsonError(error: unknown): boolean {
  return error instanceof SyntaxError && 'type' in error && error.type === 'entity.parse.failed';
}

function formatZodIssues(issues: z.core.$ZodIssue[]): string {
  return issues
    .map(issue => {
      const path: string = issue.path.join('.') || 'value';
      return `${path} → ${issue.message}`;
    })
    .join('; ');
}

export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  void next;

  let status: number = 500;
  let message: string = INTERNAL_SERVER_ERROR;

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (isMalformedJsonError(err)) {
    status = 400;
    message = MALFORMED_JSON_ERROR;
  } else if (err instanceof ZodError) {
    status = 400;
    message = `Validation failed — ${formatZodIssues(err.issues)}`;
  }

  if (status < 500)
    logger.warn({ status, code: err instanceof HttpError ? err.code : undefined }, message);
  else {
    const error = err instanceof Error ? err : undefined;

    logger.error(
      {
        errorType: error?.constructor.name ?? typeof err,
        stack: error?.stack,
        status,
        code: err instanceof HttpError ? err.code : undefined,
        requestId: RequestContext.getId(),
      },
      error?.message ?? 'Unexpected non-error value thrown',
    );

    message = INTERNAL_SERVER_ERROR;
  }

  res.status(status).json(toErrorDTO(status, message));
};
