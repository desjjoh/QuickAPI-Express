import type { Request, Response, NextFunction } from 'express';
import { RequestContext } from '@/common/store/request-context.store';
import { generateRequestId } from '@/common/helpers/nanoid.helper';
import { requestLogMethod } from '@/common/helpers/request-log.helper';

interface Context {
  requestId: string;
  timestamp: number;
  method: string;
  ip: string | undefined;
}

export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const context: Context = {
    requestId: generateRequestId(),
    timestamp: Date.now(),
    method: requestLogMethod(req),
    ip: req.ip,
  };

  res.setHeader('X-Request-Id', context.requestId);

  RequestContext.run(context, next);
}
