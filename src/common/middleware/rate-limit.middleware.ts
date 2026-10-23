import type { Request, Response, NextFunction } from 'express';
import { HttpError, RateLimitError } from '@/common/exceptions/http.exception';
import { RollingWindowLimiter } from '@/common/handlers/rate-limit.handler';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  maxClients?: number;
  keyGenerator?: (_: Request) => string;
}

export function createRateLimitMiddleware(options: RateLimitOptions) {
  const limiter = new RollingWindowLimiter(options);
  const keyGenerator = options.keyGenerator;
  const { max, windowMs } = options;

  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const key = keyGenerator?.(req) ?? req.ip ?? 'unknown';
    const decision = limiter.admit(key);

    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));

      if (decision.status === 503)
        throw new HttpError(
          503,
          'Rate limiter capacity is exhausted. Try again later.',
        );

      throw new RateLimitError(
        `Too many requests — limit is ${max} per ${windowMs / 1000}s.`,
      );
    }

    next();
  };
}
