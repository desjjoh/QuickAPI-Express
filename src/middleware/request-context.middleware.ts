import type { Request, Response, NextFunction } from 'express';
import { RequestContext } from '@/store/request-context.store';
import { generateRequestId } from '@/config/nanoid.config';

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  const context = {
    requestId: generateRequestId(),
    timestamp: Date.now(),
    path: req.path,
    method: req.method,
    ip: req.ip,
  };

  RequestContext.initialize(context);

  next();
}
