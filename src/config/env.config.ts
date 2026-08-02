import { z, ZodError } from 'zod';
import { createRequire } from 'module';
import path from 'path';
import { yellow, red, green, dim, bold } from 'colorette';

import { rootPath } from '@/common/helpers/path.helpers';

const require = createRequire(import.meta.url);
const pkgPath = path.join(rootPath, 'package.json');
const pkg = require(pkgPath);

const tcpPort = z.coerce.number().int().min(1).max(65_535);
const EnvSchema = z
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
    PORT: z.coerce.number(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),

    DB_HOST: z.string(),
    DB_PORT: tcpPort,
    DB_USER: z.string(),
    DB_PASSWORD: z.string(),
    DB_DATABASE: z.string(),
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
    red(bold(`❌ Environment validation failed (${count} issue${count === 1 ? '' : 's'})`)),
  );
  process.stderr.write('\n\n');

  for (const issue of issues) process.stderr.write(`${formatIssue(issue)}\n`);

  process.stderr.write('\n');
  process.stderr.write(dim(green('Fix the fields above and restart the application…\n\n')));
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
