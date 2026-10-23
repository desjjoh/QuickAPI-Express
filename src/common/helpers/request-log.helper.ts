import type { Request, RequestHandler } from 'express';

const routeNames = new WeakMap<Request, { prefix?: string; route?: string }>();
const methods = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

/** Only pass server-declared templates here, never req.baseUrl or URL values. */
export function logRoute(name: {
  prefix?: string;
  route?: string;
}): RequestHandler {
  return (req, _res, next) => {
    routeNames.set(req, name);
    next();
  };
}

export function requestLogRoute(req: Request): string {
  const name = routeNames.get(req);

  if (name?.route) return name.route;
  if (typeof req.route?.path !== 'string') return '<unmatched>';

  const localPath: string = req.route.path;

  return `${name?.prefix ?? ''}${localPath === '/' && name?.prefix ? '' : localPath}`;
}

export function requestLogMethod(req: Request): string {
  return methods.has(req.method) ? req.method : '<other>';
}
