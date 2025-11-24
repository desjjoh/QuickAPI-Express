import moment from 'moment';
import pino, { type Logger } from 'pino';
import { gray, cyan, yellow, red, green, magenta, dim } from 'colorette';

import { env } from '@/config/env.config';
import { RequestContext } from '@/store/request-context.store';

const defaultLevel = env.LOG_LEVEL || 'info';
const isDev = env.NODE_ENV !== 'production';

function formatTimestamp(): string {
  return moment().format('YYYY-MM-DD HH:mm:ss.SSS');
}

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

function formatLog(level: string, msg: string, context: Record<string, unknown>): string {
  const timestamp = dim(green(formatTimestamp()));
  const levelLabel = colorLevel(level);
  const rid = context.requestId ? magenta(`[${context.requestId}]`) + ' ' : '';

  const line = `${timestamp} ${levelLabel} ${rid}${msg}`;

  const meta = { ...context };

  delete meta.msg;
  delete meta.level;
  delete meta.levelLabel;

  return line;
}

const stream = {
  write(raw: string) {
    try {
      const log = JSON.parse(raw);
      const formatted = formatLog(log.levelLabel || log.level, log.msg, log);
      process.stdout.write(formatted + '\n');
    } catch {
      process.stdout.write(raw);
    }
  },
};

export const logger: Logger = pino(
  {
    level: defaultLevel,
    formatters: {
      level(label) {
        return { levelLabel: label };
      },
    },
    timestamp: false,
    mixin() {
      const ctx = RequestContext.get();
      if (!ctx) return {};

      return {
        requestId: ctx.requestId,
        method: ctx.method,
        path: ctx.path,
        ip: ctx.ip,
      };
    },
    serializers: {
      error: pino.stdSerializers.err,
    },
  },
  isDev ? stream : undefined,
);
