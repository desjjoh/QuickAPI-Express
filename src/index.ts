/**
 * @fileoverview
 *  Application entrypoint — orchestrates Express bootstrap, HTTP server startup,
 *  and full lifecycle management including graceful shutdown.
 *
 * @module index
 * @description
 *  Initializes the Express application, validates configuration, and starts the
 *  HTTP server with structured startup logging. Integrates the {@link SystemLifecycle}
 *  utility to coordinate controlled shutdown of all registered services (e.g., server,
 *  database) in response to process signals or runtime errors.
 *
 * @remarks
 *  - All environment variables are validated via {@link env-validation}.
 *  - Structured logs (startup, shutdown, errors) are emitted via {@link logger}.
 *  - Shutdown procedures are centrally coordinated by {@link SystemLifecycle.register}.
 *  - Catches and logs fatal errors during application initialization with full stack trace.
 *
 * @example
 *  ```bash
 *  npm run dev
 *  # → [INFO] Server running in development mode at http://localhost:3000
 *  # → [INFO] Swagger docs available at http://localhost:3000/docs
 *  ```
 */

import { createApp } from '@/app';
import { prisma } from '@/services/prisma';
import { env, isDev } from '@/services/env-validation';
import { logger } from '@/services/pino';
import { SystemLifecycle } from '@/core/system/lifecycle';

/**
 * Bootstraps the Express application and manages the complete server lifecycle.
 * Handles initialization, startup logging, and clean termination behavior for
 * all registered services.
 *
 * @async
 * @function bootstrap
 * @throws {Error} If the server or any critical dependency fails to initialize.
 */
async function bootstrap(): Promise<void> {
  /** The primary Express application instance, created through the app factory. */
  const app = createApp();

  /** High-resolution startup timestamp, used for measuring initialization duration. */
  const start = performance.now();

  /**
   * Launch the HTTP server and log key initialization details.
   * Provides environment mode and documentation endpoint for visibility.
   */
  const server = app.listen(env.PORT, () => {
    const mode = isDev ? 'development' : 'production';

    logger.info(
      { port: env.PORT },
      `Server running in ${mode} mode at http://localhost:${env.PORT}`,
    );

    logger.info(`Swagger docs available at http://localhost:${env.PORT}/docs`);
  });

  /**
   * Register lifecycle handlers for clean shutdown and signal management.
   * Ensures all critical resources (HTTP server, Prisma client, etc.)
   * are closed in a predictable, observable order.
   */
  SystemLifecycle.register(start, [
    { name: 'server', stop: async () => SystemLifecycle.closeServer(server) },
    { name: 'prisma', stop: async () => prisma.$disconnect() },
  ]);
}

/**
 * Top-level error boundary for the bootstrap phase.
 * Captures and logs any unhandled exceptions during startup.
 *
 * @remarks
 *  If a fatal error occurs before the logger is initialized, a minimal fallback
 *  message is printed to `stderr` to preserve crash visibility.
 */
bootstrap().catch((err: unknown) => {
  const context = bootstrap.name;
  const error = err instanceof Error ? err : new Error(String(err));

  try {
    logger.error(
      { context, err: error, stack: error.stack },
      'Fatal error during application bootstrap',
    );
  } catch {
    process.stderr.write(`Fatal error during bootstrap: ${error.message}\n`);
  }

  process.exit(1);
});
