import type { ErrorRequestHandler } from 'express';
import z, { ZodError } from 'zod';

import type { Request, Response, NextFunction } from 'express';

import { logger } from '@/config/logger.config';
import { HttpError } from '@/exceptions/http.exception';
import { toErrorDTO } from '@/models/error.model';

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
  let message: string = 'Internal Server Error';

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (err instanceof SyntaxError) {
    status = 400;
    message = err.message;
  } else if (err instanceof ZodError) {
    status = 400;
    message = `Validation failed — ${formatZodIssues(err.issues)}`;
  }

  logger.error(message);
  res.status(status).json(toErrorDTO(status, message));
};
