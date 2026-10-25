import { AsyncLocalStorage } from 'node:async_hooks';
import { RequestTimeoutError } from '@/common/exceptions/http.exception';

const requests = new AsyncLocalStorage<RequestContext>();

export class RequestAbandonedError extends RequestTimeoutError {
  constructor() {
    super('Request expired or disconnected before transaction commit.');
    this.name = 'RequestAbandonedError';
  }
}

/** Internal lifecycle state; business services never receive this object. */
export class RequestContext {
  private readonly controller = new AbortController();
  private expiresAt = Infinity;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  setDeadline(timeoutMs: number): void {
    this.expiresAt = Math.min(this.expiresAt, Date.now() + timeoutMs);
  }

  abandon(): void {
    this.controller.abort();
  }

  assertActive(): void {
    if (this.signal.aborted || Date.now() >= this.expiresAt)
      throw new RequestAbandonedError();
  }
}

export function runWithRequestContext<T>(
  context: RequestContext,
  work: () => T,
): T {
  return requests.run(context, work);
}

export function currentRequestContext(): RequestContext | undefined {
  return requests.getStore();
}

/** Non-HTTP work has no request deadline. */
export function assertRequestActive(): void {
  requests.getStore()?.assertActive();
}
