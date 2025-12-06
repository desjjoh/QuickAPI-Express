import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  requestId: string;
  timestamp: number;
  path: string;
  method: string;
  ip: string | undefined;
}

const storage: AsyncLocalStorage<RequestContextData> = new AsyncLocalStorage<RequestContextData>();

export class RequestContext {
  static initialize(data: RequestContextData) {
    storage.enterWith(data);
  }

  static get(): RequestContextData | undefined {
    return storage.getStore();
  }

  static getId(): string | undefined {
    return storage.getStore()?.requestId;
  }
}
