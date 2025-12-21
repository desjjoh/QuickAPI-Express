import type { Request, Response, NextFunction } from 'express';
import { BadRequestError } from '@/common/exceptions/http.exception';

const BLOCKLIST: Set<string> = new Set([
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'forwarded',
  'via',
  'client-ip',
  'true-client-ip',
]);

const ALLOWLIST: Set<string> = new Set([
  'host',
  'connection',
  'content-type',
  'content-length',
  'accept',
  'accept-language',
  'accept-encoding',
  'user-agent',
  'referer',
  'origin',
  'cookie',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'authorization',
  'x-csrf-token',
  'x-request-id',
  'x-api-key',
]);

const VALID_NAME_RE: RegExp = /^[A-Za-z0-9-]+$/;
const INVALID_VALUE_CHARS: Set<string> = new Set(['\r', '\n']);

export function sanitizeHeaders() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const seen: Set<string> = new Set<string>();
    const cleaned: Record<string, string | string[]> = {};

    for (const [name, value] of Object.entries(req.headers)) {
      const lower: string = name.toLowerCase();

      if (BLOCKLIST.has(lower)) {
        throw new BadRequestError(`Header '${lower}' is not allowed.`);
      }

      if (seen.has(lower)) {
        throw new BadRequestError(`Duplicate header '${lower}' is not permitted.`);
      }

      seen.add(lower);

      if (!VALID_NAME_RE.test(lower)) {
        throw new BadRequestError(`Header name '${lower}' contains invalid characters.`);
      }

      const val: string[] = Array.isArray(value) ? value : [value ?? ''];

      for (const v of val) {
        if ([...INVALID_VALUE_CHARS].some(char => v.includes(char))) {
          throw new BadRequestError('Header value contains prohibited control characters.');
        }
      }

      if (ALLOWLIST.has(lower)) {
        cleaned[lower] = value ?? '';
      }
    }

    req.headers = cleaned;

    next();
  };
}
