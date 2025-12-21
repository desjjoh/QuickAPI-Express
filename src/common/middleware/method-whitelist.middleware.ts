import type { Request, Response, NextFunction } from 'express';
import { MethodNotAllowedError } from '@/common/exceptions/http.exception';

interface Options {
  allowedMethods: Set<string>;
}

export function methodWhitelist({ allowedMethods }: Options) {
  const allowed: Set<string> = new Set([...allowedMethods].map(m => m.toUpperCase()));

  return (req: Request, _res: Response, next: NextFunction) => {
    const method: string = req.method.toUpperCase();

    if (!allowed.has(method)) throw new MethodNotAllowedError(method);

    next();
  };
}
