import type { Request, Response, NextFunction } from 'express';
import { UnsupportedMediaTypeError } from '@/common/exceptions/http.exception';

interface RouteOverride {
  prefix: string;
  allowed: Set<string>;
}

interface Options {
  defaultAllowed?: Set<string>;
  routeOverrides?: RouteOverride[];
}

const NO_BODY_METHODS: Set<string> = new Set(['GET', 'DELETE', 'HEAD', 'OPTIONS']);

export function enforceContentType(options: Options = {}) {
  const defaultAllowed: Set<string> = options.defaultAllowed ?? new Set(['application/json']);
  const routeOverrides: RouteOverride[] = options.routeOverrides ?? [];

  function allowedForPath(path: string): Set<string> {
    for (const { prefix, allowed } of routeOverrides) {
      if (path.startsWith(prefix)) return allowed;
    }

    return defaultAllowed;
  }

  return (req: Request, _res: Response, next: NextFunction) => {
    const method: string = req.method.toUpperCase();
    const contentType: string | undefined = req.headers['content-type'];

    if (NO_BODY_METHODS.has(method)) {
      if (contentType !== undefined)
        throw new UnsupportedMediaTypeError(
          `HTTP method '${method}' does not accept a request body.`,
        );

      return next();
    }

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const allowed: Set<string> = allowedForPath(req.path);

      if (!contentType) throw new UnsupportedMediaTypeError('Missing Content-Type header.');

      const normalized: string = contentType.split(';')[0].trim().toLowerCase();

      if (!allowed.has(normalized)) {
        const expected: string[] = Array.from(allowed).sort();
        throw new UnsupportedMediaTypeError(
          `Content-Type '${contentType}' is not allowed on this endpoint. Expected one of: ${expected}.`,
        );
      }
    }

    next();
  };
}
