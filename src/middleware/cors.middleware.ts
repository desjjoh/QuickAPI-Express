// src/middleware/cors.middleware.ts
import { ForbiddenError } from '@/exceptions/http.exception';
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
  return function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
    const origin: string | null = req.headers.origin ?? null;

    // Check if origin is allowed
    if (!isAllowedOrigin(opts, origin)) {
      throw new ForbiddenError(`CORS origin '${origin}' not allowed.`);
    }

    // CORS header: Access-Control-Allow-Origin
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (opts.origin === '*' || (Array.isArray(opts.origin) && opts.origin.includes('*'))) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    // Static CORS headers
    res.setHeader('Access-Control-Allow-Methods', opts.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', opts.allowedHeaders.join(', '));
    res.setHeader('Access-Control-Expose-Headers', opts.exposedHeaders.join(', '));
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

  if (allowed === '*' || (Array.isArray(allowed) && allowed.includes('*'))) {
    return true;
  }

  if (Array.isArray(allowed)) {
    return allowed.includes(origin);
  }

  return allowed === origin;
}
