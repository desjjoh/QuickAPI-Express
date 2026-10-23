import type { Request, Response, NextFunction } from 'express';

import { logger } from '@/config/logger.config';
import { shortenPath } from '@/common/helpers/string.helpers';
import { observeRequestOutcome } from '@/common/handlers/request-outcome.handler';
import { RequestContext } from '@/common/store/request-context.store';

export function httpLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const context = RequestContext.get();

  observeRequestOutcome(req, res, (result) => {
    const { outcome, method, route, status: statusCode } = result;
    const duration = result.durationMs.toFixed(2);

    let level: 'error' | 'warn' | 'debug' = 'debug';

    if (outcome === 'aborted' || (statusCode ?? 0) >= 400) level = 'warn';
    if ((statusCode ?? 0) >= 500) level = 'error';

    const pathPadded: string = shortenPath(route, 30).padEnd(32);
    const status: string =
      outcome === 'aborted' ? 'ABORTED' : String(statusCode).padEnd(3, ' ');
    const methodPadded: string = method.padEnd(7, ' ');

    logger[level](
      {
        requestId: context?.requestId,
        ip: context?.ip,
        outcome,
        headersSent: result.headersSent,
        method,
        route,
        ...(statusCode === undefined ? {} : { status: statusCode }),
        durationMs: result.durationMs,
      },
      `${status} ${methodPadded} ${pathPadded} ${duration}ms`,
    );
  });

  next();
}
