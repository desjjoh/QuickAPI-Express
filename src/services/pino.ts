/**
 * @fileoverview Pino logger configuration.
 * @module services/pino
 * @description
 *  Provides a preconfigured Pino logger instance for structured and performant
 *  application logging. Uses human-readable formatting in development and JSON
 *  logs in production for integration with log aggregation systems.
 *
 * @remarks
 *  - Uses ISO timestamps for consistency across services.
 *  - Enables colorized, single-line logs in development.
 *  - Avoids heavy transformations or async transports for production stability.
 *
 * @example
 *  import { logger } from "@/services/pino";
 *  logger.info("Server started");
 *  logger.error({ err }, "Unhandled exception");
 */

import pino, { type Logger } from 'pino';

/** Default log level, configurable via environment variable. */
const defaultLevel = process.env.LOG_LEVEL || 'info';

/** Environment check for enabling pretty-print mode. */
const isDev = process.env.NODE_ENV !== 'production';

/**
 * Shared Pino logger instance.
 *
 * @constant
 * @type {Logger}
 * @description
 *  Configures structured JSON logging in production and
 *  human-readable pretty logging in development environments.
 */
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
