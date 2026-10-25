import type { Request, Response, RequestHandler } from 'express';
import { HttpError } from '@/common/exceptions/http.exception';
import { logger } from '@/config/logger.config';
import {
  RequestContext,
  RequestAbandonedError,
  runWithRequestContext,
} from '@/common/helpers/request-context.helper';

type RequestState = {
  tracker: RequestWorkTracker;
  context: RequestContext;
};

const requests = new WeakMap<object, RequestState>();

/** Tracks handler promises independently of whether their HTTP connection is still open. */
export class RequestWorkTracker {
  public accepting = true;

  private readonly pending = new Set<Promise<unknown>>();

  public readonly admit: RequestHandler = (req, res, next) => {
    if (!this.accepting) {
      res.setHeader('Connection', 'close');
      next(new HttpError(503, 'Application is shutting down.'));

      return;
    }

    const state = { tracker: this, context: new RequestContext() };

    requests.set(req, state);

    const cleanup = () => {
      if (!res.writableFinished) abandonRequest(req);

      req.off('aborted', cleanup);
      res.off('finish', cleanup);
      res.off('close', cleanup);
    };

    req.once('aborted', cleanup);
    res.once('finish', cleanup);
    res.once('close', cleanup);
    next();
  };

  public async run(work: () => Promise<void>): Promise<void> {
    const pending = Promise.resolve().then(work);

    this.pending.add(pending);

    try {
      await pending;
    } finally {
      this.pending.delete(pending);
    }
  }

  /** Call after transport closure: no new handler may start on a closed response. */
  public async drain(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }
}

export function abandonRequest(req: Request): void {
  const state = requests.get(req);

  state?.context.abandon();
}

export function canRespond(req: object, res: Response): boolean {
  return (
    !requests.get(req)?.context.signal.aborted &&
    !res.writableEnded &&
    !res.destroyed
  );
}

export function setRequestDeadline(req: object, timeoutMs: number): void {
  requests.get(req)?.context.setDeadline(timeoutMs);
}

/** Async routes must use this boundary, including reads that keep database connections busy. */
export function trackHandler<R extends object, S extends Response>(
  handler: (req: R, res: S) => Promise<void>,
): RequestHandler {
  return async (req, res, next) => {
    if (!canRespond(req, res)) return;

    const work = async () => {
      if (!canRespond(req, res)) return;

      try {
        // Route validation establishes the handler's parsed request contract.
        await handler(req as unknown as R, res as unknown as S);
      } catch (error) {
        if (!canRespond(req, res)) {
          if (error instanceof RequestAbandonedError) return;
          logger.error(
            { error },
            'Request work failed after its response closed.',
          );
        } else {
          next(error);
        }
      }
    };

    const state = requests.get(req);

    if (state)
      await state.tracker.run(() => runWithRequestContext(state.context, work));
    else await work();
  };
}
