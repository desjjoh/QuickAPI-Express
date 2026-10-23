import { ForbiddenError } from '@/common/exceptions/http.exception';
import type { Request, Response, NextFunction } from 'express';

export interface CorsOptions {
  origin: string | string[];
  methods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  credentials?: boolean;
  maxAge?: number;
}

export function createCorsMiddleware(opts: CorsOptions) {
  return function corsMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const origin: string | null = req.headers.origin ?? null;

    // Include absent/disallowed origins too, so caches cannot reuse another origin's response.
    res.vary('Origin');

    if (req.method === 'OPTIONS') {
      res.vary('Access-Control-Request-Method');
      res.vary('Access-Control-Request-Headers');
    }

    // Check if origin is allowed
    if (!isAllowedOrigin(opts, origin)) {
      throw new ForbiddenError(`CORS origin '${origin}' not allowed.`);
    }

    // CORS header: Access-Control-Allow-Origin
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    if (
      origin &&
      req.method === 'OPTIONS' &&
      req.headers['access-control-request-method']
    ) {
      const method = req.headers['access-control-request-method'];
      const headers = req.headers['access-control-request-headers'];
      const allowed = new Set(
        opts.allowedHeaders.map((header) => header.toLowerCase()),
      );

      if (
        typeof method !== 'string' ||
        !opts.methods.includes(method) ||
        (headers !== undefined &&
          (typeof headers !== 'string' ||
            headers
              .split(',')
              .some((header) => !allowed.has(header.trim().toLowerCase()))))
      ) {
        throw new ForbiddenError(
          'CORS preflight method or headers not allowed.',
        );
      }
    }

    // Static CORS headers
    res.setHeader('Access-Control-Allow-Methods', opts.methods.join(', '));
    res.setHeader(
      'Access-Control-Allow-Headers',
      opts.allowedHeaders.join(', '),
    );
    res.setHeader(
      'Access-Control-Expose-Headers',
      opts.exposedHeaders.join(', '),
    );
    res.setHeader('Access-Control-Max-Age', String(opts.maxAge ?? 86400));

    if (opts.credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // OPTIONS → preflight
    if (req.method === 'OPTIONS') {
      res.status(204).send();

      return;
    }

    next();
  };
}

function isAllowedOrigin(opts: CorsOptions, origin: string | null): boolean {
  if (!origin) return true;

  const allowed: string | string[] = opts.origin;

  if (Array.isArray(allowed)) {
    return allowed.includes(origin);
  }

  return allowed === origin;
}
