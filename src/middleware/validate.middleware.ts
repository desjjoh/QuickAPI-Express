import { ZodError } from 'zod';
import type { ZodObject } from 'zod';
import type { Request, Response, NextFunction } from 'express';

import { BadRequestError } from '@/exceptions/http.exception';

export const validate =
  (schema: ZodObject) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const data = schema.parse(req.body);
      req.body = data;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const message = err.issues.map(e => e.message).join(', ');
        next(new BadRequestError(`Validation failed: ${message}`));
      } else {
        next(err);
      }
    }
  };
