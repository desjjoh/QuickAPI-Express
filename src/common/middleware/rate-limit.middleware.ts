import type { Request, Response, NextFunction } from 'express';
import { RateLimitError } from '@/common/exceptions/http.exception';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (_: Request) => string;
}

export function createRateLimitMiddleware(options: RateLimitOptions) {
  const store: Map<string, number[]> = new Map();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const now: number = Date.now();
    const key: string = options.keyGenerator?.(req) ?? req.ip ?? 'unknown';

    const windowStart: number = now - options.windowMs;

    const timestamps: number[] = store.get(key) ?? [];
    const recent: number[] = timestamps.filter(ts => ts > windowStart);

    recent.push(now);
    store.set(key, recent);

    if (recent.length > options.max) {
      res.setHeader('Retry-After', String(options.windowMs / 1000));

      throw new RateLimitError(
        `Too many requests — limit is ${options.max} per ${options.windowMs / 1000}s.`,
      );
    }

    next();
  };
}
