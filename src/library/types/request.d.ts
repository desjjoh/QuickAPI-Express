declare global {
  namespace Express {
    interface Request {
      validated?: {
        params: P;
        query: Q;
        body: B;
      };
    }
  }
}

export interface LocalParsedQs {
  [key: string]: undefined | string | string[] | LocalParsedQs | LocalParsedQs[];
}

export interface ValidatedRequest<P = unknown, Q = unknown, B = unknown>
  extends Request<P, never, B, Q> {
  validated?: {
    params: P;
    query: Q;
    body: B;
  };
}
