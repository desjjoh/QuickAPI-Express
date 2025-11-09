import moment from 'moment';
import pino, { type Logger } from 'pino';
import { gray, cyan, yellow, red, green, magenta, dim } from 'colorette';

const defaultLevel = process.env.LOG_LEVEL || 'info';
const isDev = process.env.NODE_ENV !== 'production';

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

function formatLog(level: string, msg: string, context: Record<string, unknown>): string {
  const timestamp = dim(green(formatTimestamp()));
  const levelLabel = colorLevel(level);

  let line = `${timestamp} ${levelLabel} ${msg}`;

  const meta = { ...context };

  delete meta.service;
  delete meta.msg;
  delete meta.level;
  delete meta.levelLabel;

  if (Object.keys(meta).length) {
    const metaStr = Object.entries(meta)
      .map(([k, v]) => `${gray(k)}=${String(v)}`)
      .join(' ');
    line += `\n     ${metaStr}`;
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
    base: { service: 'quickapi' },
    timestamp: false,
  },
  isDev ? stream : undefined,
);
