/**
 * @fileoverview Application entrypoint and server lifecycle bootstrap.
 * @module index
 * @description
 *  Initializes the Express application, starts the HTTP server, and registers
 *  graceful shutdown handlers. Provides structured logging for startup timing,
 *  runtime mode, and documentation endpoints.
 *
 * @remarks
 *  - All configuration is validated through `env-validation`.
 *  - Logs startup information, port bindings, and runtime mode.
 *  - Delegates process signal handling to the `SystemLifecycle` utility.
 *
 * @example
 *  npm run dev
 *  # -> [INFO] Server running in development mode at http://localhost:3000
 *  # -> [INFO] Swagger docs available at http://localhost:3000/docs
 */

import { createApp } from '@/app';
import { env, isDev } from '@/config/env-validation';
import { logger } from '@/logger/logger';
import { SystemLifecycle } from './system/lifecycle';

/** Express application instance created via centralized factory. */
const app = createApp();

/** Startup timestamp for performance measurement. */
const start = performance.now();

/**
 * Starts the Express HTTP server and logs initialization details.
 * Displays the running mode and documentation endpoint for convenience.
 */
const server = app.listen(env.PORT, () => {
  const mode = isDev ? 'development' : 'production';

  logger.info({ port: env.PORT }, `Server running in ${mode} mode at http://localhost:${env.PORT}`);

  logger.info(`Swagger docs available at http://localhost:${env.PORT}/docs`);
});

/**
 * Registers graceful shutdown and lifecycle management handlers.
 * Ensures the server closes cleanly and logs total uptime duration.
 */
SystemLifecycle.register(server, start);
