import { ValidationError } from '@/exceptions/http.exception';
import { formatZodIssues } from '@/helpers/string.helpers';
import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';

export interface RequestValidationSchemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

export function validateRequest<S extends RequestValidationSchemas>(schemas: S) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.validated = {
      params: null,
      query: null,
      body: null,
    };

    if (schemas.params) {
      const parsed = schemas.params.safeParse(req.params);

      if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error.issues, 'path'));
      req.validated.params = parsed.data;
    }

    if (schemas.query) {
      const parsed = schemas.query.safeParse(req.query);

      if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error.issues, 'query'));
      req.validated.query = parsed.data;
    }

    if (schemas.body) {
      const parsed = schemas.body.safeParse(req.body);

      if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error.issues, 'body'));
      req.validated.body = parsed.data;
    }

    next();
  };
}
