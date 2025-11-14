import type { Request, Response, NextFunction } from 'express';
import { httpRequestCounter, httpRequestDuration } from '@/config/metrics.config';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const route = req.route?.path || 'unknown_route';
    const method = req.method;
    const status = res.statusCode.toString();

    httpRequestCounter.inc({ method, route, status });

    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    httpRequestDuration.observe({ method, route, status }, durationMs);
  });

  next();
}
