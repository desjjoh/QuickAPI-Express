import { NotFoundError } from '@/exceptions/http.exception';
import type { Request, Response, NextFunction } from 'express';

export const not_found = (req: Request, _res: Response, next: NextFunction): void => {
  const method = req.method;
  const url = req.originalUrl;

  next(new NotFoundError(`Route not found — No route matches ${method} ${url}.`));
};
