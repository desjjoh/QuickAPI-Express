import type { Request, Response, NextFunction } from 'express';
import { RequestContext } from '@/common/store/request-context.store';
import { generateRequestId } from '@/common/helpers/nanoid.helper';

interface Context {
  requestId: string;
  timestamp: number;
  path: string;
  method: string;
  ip: string | undefined;
}

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  const context: Context = {
    requestId: generateRequestId(),
    timestamp: Date.now(),
    path: req.path,
    method: req.method,
    ip: req.ip,
  };

  RequestContext.initialize(context);

  next();
}
