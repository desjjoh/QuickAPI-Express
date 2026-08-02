import express from 'express';
import type { Request, Response, NextFunction } from 'express';

import { RequestBodyTooLargeError } from '@/common/exceptions/http.exception';

interface BodyLimitOptions {
  defaultLimit: number;
  routeOverrides?: Array<[string, number]>;
}

function isEntityTooLargeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.too.large'
  );
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

    res.setHeader('X-Body-Limit-Bytes', String(limit));
    res.setHeader('X-Body-Remaining-Bytes', String(limit));

    const jsonParser = express.json({
      limit,
      verify: (_req, _res, body) => {
        res.setHeader('X-Body-Remaining-Bytes', String(Math.max(limit - body.length, 0)));
      },
    });

    jsonParser(req, res, error => {
      if (isEntityTooLargeError(error)) {
        res.setHeader('X-Body-Remaining-Bytes', '0');
        next(new RequestBodyTooLargeError(limit));
        return;
      }

      next(error);
    });
  };
}
