import moment from 'moment';
import pino, { type Logger } from 'pino';
import { gray, cyan, yellow, red, green, magenta, dim } from 'colorette';

import { env } from './env-validation';

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
  return color(`[${level}]`);
}

function formatLog(level: string, msg: string): string {
  const timestamp = dim(green(formatTimestamp()));
  const levelLabel = colorLevel(level);

  return `${timestamp} ${levelLabel} ${msg}`;
}

const stream = {
  write(raw: string) {
    try {
      const log = JSON.parse(raw);
      const formatted = formatLog(log.levelLabel || log.level, log.msg);
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
  },
  isDev ? stream : undefined,
);
