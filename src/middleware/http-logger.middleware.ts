import type { Request, Response, NextFunction } from 'express';

import { logger } from '@/config/pino.config';

export function httpLogger(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = (performance.now() - start).toFixed(2);
    const { statusCode } = res;

    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'debug';

    logger[level](`${method} ${originalUrl} ${statusCode} ~ ${duration}ms`);
  });

  next();
}
