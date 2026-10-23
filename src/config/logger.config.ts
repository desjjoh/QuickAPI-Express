import moment from 'moment';
import pino, {
  type Logger,
  type DestinationStream,
  type LevelWithSilent,
} from 'pino';
import { gray, cyan, yellow, red, green, magenta, dim } from 'colorette';
import os from 'node:os';

import { env } from '@/config/env.config';
import { RequestContext } from '@/common/store/request-context.store';
import { errorDiagnostics } from '@/common/helpers/error-diagnostics.helper';

// Request/provider payloads are excluded entirely. Redaction is defense in depth;
// callers must still use fixed messages and the error diagnostics serializer.
const excludedFields = [
  'req',
  'res',
  'request',
  'response',
  'body',
  'query',
  'params',
  'headers',
  'cookies',
  'cookie',
  'authorization',
  'password',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'secret',
  'apiKey',
  'api_key',
  'client_secret',
  'idempotencyKey',
  'replay',
  'payload',
  'stack',
  'sql',
  'sqlMessage',
];

const levelColors: Record<string, (_str: string) => string> = {
  trace: gray,
  debug: cyan,
  info: green,
  warn: yellow,
  error: red,
  fatal: magenta,
};

function colorLevel(level: string): string {
  const color = levelColors[level] || gray;

  return color(`[${level.padEnd(5, ' ')}]`);
}

function formatLog(
  level: string,
  msg: string,
  context: Record<string, unknown>,
): string {
  const timestamp = dim(
    green(moment(context.time as string).format('YYYY-MM-DD HH:mm:ss.SSS')),
  );
  const levelLabel = colorLevel(level);
  const rid = context.requestId ? magenta(`[${context.requestId}]`) + ' ' : '';
  const pid = context.pid ? cyan(`[${context.pid}]`) + ' ' : '';

  const diagnostics = ['error', 'err', 'reason']
    .filter(
      (field) => typeof context[field] === 'object' && context[field] !== null,
    )
    .map((field) => `\n  ${field}: ${JSON.stringify(context[field])}`)
    .join('');

  return `${timestamp} ${pid}${levelLabel} ${rid}${msg}${diagnostics}`;
}

export function createLogger(
  {
    level = env.LOG_LEVEL,
    production = env.NODE_ENV === 'production',
  }: {
    level?: LevelWithSilent;
    production?: boolean;
  } = {},
  destination: DestinationStream = process.stdout,
): Logger {
  const stream: DestinationStream = production
    ? destination
    : {
        write(raw: string) {
          const log = JSON.parse(raw);

          destination.write(formatLog(log.levelLabel, log.msg, log) + '\n');
        },
      };

  return pino(
    {
      level,
      formatters: {
        level(label) {
          return { levelLabel: label };
        },
      },
      base: {
        pid: process.pid,
        hostname: os.hostname(),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: excludedFields.flatMap((field) => [field, `*.${field}`]),
        remove: true,
      },
      mixin() {
        const ctx = RequestContext.get();

        if (!ctx) return {};

        return {
          requestId: ctx.requestId,
          method: ctx.method,
          ip: ctx.ip,
        };
      },
      serializers: {
        error: errorDiagnostics,
        err: errorDiagnostics,
        reason: errorDiagnostics,
      },
    },
    stream,
  );
}

export const logger: Logger = createLogger();
