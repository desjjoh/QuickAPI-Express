import 'dotenv/config';

import { z, ZodError } from 'zod';
import { createRequire } from 'module';
import path from 'path';
import { isIP } from 'node:net';
import { yellow, red, green, dim, bold } from 'colorette';

import { rootPath } from '@/common/helpers/path.helpers';

const require = createRequire(import.meta.url);
const pkgPath = path.join(rootPath, 'package.json');
const pkg = require(pkgPath);

const numericPort = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? Number.NaN : value,
  z.coerce.number().int().min(0).max(65_535),
);
const tcpPort = numericPort.refine(
  (port) => port > 0,
  'Port must be between 1 and 65535',
);
const requiredDatabaseValue = z.string().trim().min(1);

const commaSeparated = z
  .string()
  .transform((value) =>
    value.trim() === '' ? [] : value.split(',').map((entry) => entry.trim()),
  );
const headerName = z.string().regex(/^[A-Za-z0-9-]+$/);
const corsOrigin = z.string().refine((value) => {
  try {
    const url = new URL(value);

    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}, 'Use an exact HTTP(S) origin without a path, credentials, query, or fragment');
const trustedProxy = z.string().refine((value) => {
  const [address, prefix, ...extra] = value.split('/');
  const family = isIP(address);

  if (!family || address.includes('%') || extra.length > 0) return false;
  if (prefix === undefined) return true;

  return (
    /^\d+$/.test(prefix) &&
    Number(prefix) > 0 &&
    Number(prefix) <= (family === 4 ? 32 : 128)
  );
}, 'Use an IP address or CIDR with a nonzero prefix; blanket trust and hop counts are not supported');

export const EnvSchema = z
  .object({
    APP_NAME: z.string().default(pkg.name),
    APP_VERSION: z
      .string()
      .regex(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/,
        'APP_VERSION must follow full SemVer (e.g., 1.2.3 or 1.2.3-beta+001)',
      )
      .default(pkg.version),
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: numericPort,
    LOG_LEVEL: z.enum([
      'fatal',
      'error',
      'warn',
      'info',
      'debug',
      'trace',
      'silent',
    ]),

    TRUST_PROXY: commaSeparated.pipe(z.array(trustedProxy)).default([]),
    CORS_ORIGINS: commaSeparated
      .pipe(z.array(corsOrigin).min(1))
      .default(['http://localhost:3000']),
    CORS_METHODS: commaSeparated
      .pipe(
        z
          .array(
            z.enum([
              'GET',
              'POST',
              'PUT',
              'DELETE',
              'PATCH',
              'HEAD',
              'OPTIONS',
            ]),
          )
          .min(1),
      )
      .default(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']),
    CORS_ALLOWED_HEADERS: commaSeparated
      .pipe(z.array(headerName))
      .default(['content-type', 'authorization', 'x-requested-with']),
    CORS_EXPOSED_HEADERS: commaSeparated
      .pipe(z.array(headerName))
      .default(['authorization', 'set-cookie']),
    CORS_CREDENTIALS: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    CORS_MAX_AGE_SECONDS: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? Number.NaN : value,
      z.coerce.number().int().min(0).max(86_400).default(86_400),
    ),

    DB_HOST: requiredDatabaseValue,
    DB_PORT: tcpPort,
    DB_USER: requiredDatabaseValue,
    DB_PASSWORD: requiredDatabaseValue,
    DB_DATABASE: requiredDatabaseValue,
  })
  .refine(({ NODE_ENV, PORT }) => NODE_ENV === 'test' || PORT !== 0, {
    message: 'PORT must be between 1 and 65535 outside the test environment',
    path: ['PORT'],
  });

export type Env = z.infer<typeof EnvSchema>;

/** Validate an environment-shaped input without reading or mutating process state. */
export function parseEnv(input: NodeJS.ProcessEnv): Env {
  return EnvSchema.parse(input);
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const field = issue.path.join('.') || '(root)';
  const receivedMatch = issue.message.match(/received\s"?(.*?)"?$/);
  const received = receivedMatch ? receivedMatch[1] : undefined;
  const cleaned = issue.message
    .replace(/^Invalid input[:, ]*/, '')
    .replace(/^Invalid enum value[:, ]*/, '')
    .replace(/received\s.*$/, '')
    .trim();
  const message = received
    ? `${yellow(field)} → ${cleaned} (received: ${red(`"${received}"`)})`
    : `${yellow(field)} → ${cleaned}`;

  return `  - ${message}`;
}

function printEnvErrors(issues: z.ZodIssue[]): void {
  const count = issues.length;

  process.stderr.write(
    red(
      bold(
        `❌ Environment validation failed (${count} issue${count === 1 ? '' : 's'})`,
      ),
    ),
  );
  process.stderr.write('\n\n');

  for (const issue of issues) process.stderr.write(`${formatIssue(issue)}\n`);

  process.stderr.write('\n');
  process.stderr.write(
    dim(green('Fix the fields above and restart the application…\n\n')),
  );
}

let env: Env;

try {
  env = parseEnv(process.env);
} catch (error) {
  if (error instanceof ZodError) printEnvErrors(error.issues);

  throw error;
}

export { env };

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
