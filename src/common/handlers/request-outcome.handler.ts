import type { Request, Response } from 'express';

import {
  requestLogMethod,
  requestLogRoute,
} from '@/common/helpers/request-log.helper';

export type RequestOutcome = {
  outcome: 'completed' | 'aborted';
  method: string;
  route: string;
  durationMs: number;
  headersSent: boolean;
  status?: number;
};

type Observer = (outcome: RequestOutcome) => void;
type Observation = { callbacks: Observer[]; result?: RequestOutcome };

const observations = new WeakMap<Request, Observation>();

/** One transport observation per request, shared by logs and metrics. No socket listeners. */
export function observeRequestOutcome(
  req: Request,
  res: Response,
  callback: Observer,
): void {
  const existing = observations.get(req);

  if (existing) {
    if (existing.result) callback(existing.result);
    else existing.callbacks.push(callback);

    return;
  }

  const start = performance.now();
  const observation: Observation = { callbacks: [callback] };

  observations.set(req, observation);

  const settle = () => {
    if (observation.result) return;

    req.off('aborted', settle);
    res.off('finish', settle);
    res.off('close', settle);
    const completed = res.writableFinished;
    const result: RequestOutcome = {
      outcome: completed ? 'completed' : 'aborted',
      method: requestLogMethod(req),
      route: requestLogRoute(req),
      durationMs: Math.max(0, performance.now() - start),
      headersSent: res.headersSent,
      ...(completed || res.headersSent ? { status: res.statusCode } : {}),
    };

    observation.result = result;
    const callbacks = observation.callbacks.splice(0);

    for (const notify of callbacks) notify(result);
  };

  req.once('aborted', settle);
  res.once('finish', settle);
  res.once('close', settle);
}
