import type { Request, Response, NextFunction } from 'express';

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  const path = req.originalUrl ?? req.url;

  if (path.startsWith('/docs') || path.startsWith('/redoc') || path.startsWith('/openapi.json')) {
    return next();
  }

  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');

  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join('; '),
  );

  next();
}
