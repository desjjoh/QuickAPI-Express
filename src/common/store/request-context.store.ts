import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  requestId: string;
  timestamp: number;
  method: string;
  ip: string | undefined;
}

const storage: AsyncLocalStorage<RequestContextData> =
  new AsyncLocalStorage<RequestContextData>();

export class RequestContext {
  static run<T>(data: RequestContextData, work: () => T): T {
    return storage.run(data, work);
  }

  static get(): RequestContextData | undefined {
    return storage.getStore();
  }

  static getId(): string | undefined {
    return storage.getStore()?.requestId;
  }
}
