import type { Request, Response, NextFunction } from 'express';

import { logger } from '@/config/logger.config';
import { shortenPath } from '@/helpers/string.helpers';

export function httpLogger(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = (performance.now() - start).toFixed(2);
    const { statusCode } = res;

    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'debug';

    const pathPadded = shortenPath(originalUrl, 30).padEnd(32);
    const status = String(statusCode).padEnd(3, ' ');
    const methodPadded = method.padEnd(7, ' ');

    logger[level](`${status} ${methodPadded} ${pathPadded} ${duration}ms`);
  });

  next();
}
