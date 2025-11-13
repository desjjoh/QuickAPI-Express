import { BadRequestError } from '@/exceptions/http.exception';
import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';

export interface RequestValidationSchemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

export function validateRequest(schemas: RequestValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (schemas.params) {
      const parsed = schemas.params.safeParse(req.params);

      if (!parsed.success) {
        throw new BadRequestError(
          'Param validation failed: ' + parsed.error.issues.map(i => i.message).join(', '),
        );
      }
    }

    if (schemas.query) {
      const parsed = schemas.query.safeParse(req.query);

      if (!parsed.success) {
        throw new BadRequestError(
          'Query validation failed: ' + parsed.error.issues.map(i => i.message).join(', '),
        );
      }
    }

    if (schemas.body) {
      const parsed = schemas.body.safeParse(req.body);

      if (!parsed.success) {
        throw new BadRequestError(
          'Body validation failed: ' + parsed.error.issues.map(i => i.message).join(', '),
        );
      }
    }

    next();
  };
}
