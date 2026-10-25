import type { Request, Response, NextFunction } from 'express';
import { RequestTimeoutError } from '@/common/exceptions/http.exception';
import {
  abandonRequest,
  setRequestDeadline,
} from '@/common/handlers/request-lifecycle.handler';

/** A response deadline, not cancellation of handler promises or database mutations. */
export function requestTimeout(timeoutMs: number = 10_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    setRequestDeadline(req, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      req.off('aborted', disconnected);
      res.off('finish', cleanup);
      res.off('close', disconnected);
    };

    const disconnected = () => {
      if (!res.writableFinished) abandonRequest(req);
      cleanup();
    };

    const timer = setTimeout(() => {
      abandonRequest(req);
      cleanup();
      if (res.destroyed || res.writableFinished) return;
      const error = new RequestTimeoutError(
        'Application response deadline exceeded.',
      );

      if (res.headersSent) res.destroy(error);
      else next(error);
    }, timeoutMs);

    req.once('aborted', disconnected);
    res.once('finish', cleanup);
    res.once('close', disconnected);
    next();
  };
}
