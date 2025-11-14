import moment from 'moment';
import pino, { type Logger } from 'pino';
import { gray, cyan, yellow, red, green, magenta, blue, dim } from 'colorette';

import { env } from '@/config/env.config';

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

  let line = `${timestamp} ${levelLabel} ${msg}`;

  const meta = { ...context };

  delete meta.msg;
  delete meta.level;
  delete meta.levelLabel;

  if (Object.keys(meta).length) {
    const metaStr = Object.entries(meta)
      .map(([k, v]) => `${blue(k)}${gray(`=${String(v)}`)}`)
      .join(' ');
    line += ` ${metaStr}`;
  }

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
    base: undefined,
    timestamp: false,
  },
  isDev ? stream : undefined,
);
