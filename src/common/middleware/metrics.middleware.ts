import type { Request, Response, NextFunction } from 'express';
import {
  httpRequestCounter,
  httpRequestDuration,
  httpRequestAbortedCounter,
} from '@/config/metrics.config';
import { observeRequestOutcome } from '@/common/handlers/request-outcome.handler';

export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  observeRequestOutcome(req, res, (result) => {
    const { method, route } = result;

    if (result.outcome === 'aborted') {
      httpRequestAbortedCounter.inc({ method, route });

      return;
    }

    const status = String(result.status);

    httpRequestCounter.inc({ method, route, status });

    httpRequestDuration.observe({ method, route, status }, result.durationMs);
  });

  next();
}
