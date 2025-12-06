import type { Request, Response, NextFunction } from 'express';

import { logger } from '@/config/logger.config';
import { shortenPath } from '@/helpers/string.helpers';

export function httpLogger(req: Request, res: Response, next: NextFunction): void {
  const start: number = performance.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration: string = (performance.now() - start).toFixed(2);
    const { statusCode } = res;

    const level: 'error' | 'warn' | 'debug' =
      statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'debug';

    const pathPadded: string = shortenPath(originalUrl, 30).padEnd(32);
    const status: string = String(statusCode).padEnd(3, ' ');
    const methodPadded: string = method.padEnd(7, ' ');

    logger[level](`${status} ${methodPadded} ${pathPadded} ${duration}ms`);
  });

  next();
}
