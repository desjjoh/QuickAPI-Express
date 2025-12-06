import type { Request, Response, NextFunction } from 'express';
import { RequestBodyTooLargeError } from '@/exceptions/http.exception';

declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer;
  }
}

interface BodyLimitOptions {
  defaultLimit: number;
  routeOverrides?: Array<[string, number]>;
}

export function bodyLimitMiddleware(options: BodyLimitOptions) {
  const { defaultLimit, routeOverrides = [] } = options;

  function selectLimit(path: string): number {
    for (const [prefix, limit] of routeOverrides) {
      if (path.startsWith(prefix)) return limit;
    }
    return defaultLimit;
  }

  return function (req: Request, res: Response, next: NextFunction) {
    const limit: number = selectLimit(req.path);
    let total: number = 0;
    const chunks: Buffer[] = [];
    let limitExceeded: boolean = false;

    req.on('data', (chunk: Buffer) => {
      if (limitExceeded || res.headersSent) return;

      total += chunk.length;

      if (total > limit) {
        limitExceeded = true;

        req.pause();

        res.setHeader('X-Body-Limit-Bytes', String(limit));
        res.setHeader('X-Body-Remaining-Bytes', '0');

        next(new RequestBodyTooLargeError(limit));
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (limitExceeded || res.headersSent) return;

      const remaining = Math.max(limit - total, 0);

      res.setHeader('X-Body-Limit-Bytes', String(limit));
      res.setHeader('X-Body-Remaining-Bytes', String(remaining));
    });

    next();
  };
}
