import pino, { type Logger } from 'pino';

const defaultLevel = process.env.LOG_LEVEL || 'info';
const isDev = process.env.NODE_ENV !== 'production';

export const logger: Logger = pino({
  level: defaultLevel,
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: { singleLine: true, colorize: true },
      }
    : undefined,
  base: { service: 'quickapi-express' },
  timestamp: pino.stdTimeFunctions.isoTime,
});
