/**
 * @fileoverview
 *  Centralized application lifecycle manager for graceful startup and shutdown.
 *
 * @module core/system/lifecycle
 * @description
 *  Coordinates clean termination of all registered services (e.g., HTTP server,
 *  database clients, queues, etc.) when receiving process signals (`SIGINT`, `SIGTERM`)
 *  or before normal process exit. Ensures predictable teardown order, detailed
 *  timing metrics, and structured observability through the global logger.
 *
 * @remarks
 *  - Prevents duplicate shutdown execution using a static guard flag.
 *  - Measures uptime and per-service shutdown durations using `performance.now()`.
 *  - Ensures fatal shutdown errors result in a forced exit (`process.exit(1)`).
 *  - Designed for integration in both monolithic and microservice architectures.
 *
 * @example
 *  ```ts
 *  import { SystemLifecycle } from '@/system/lifecycle';
 *  import { prisma } from '@/db/prisma';
 *  import { logger } from '@/logger/logger';
 *  import { app } from '@/app';
 *
 *  const start = performance.now();
 *  const server = app.listen(3000);
 *
 *  SystemLifecycle.register(start, [
 *    { name: 'server', stop: async () => SystemLifecycle.closeServer(server) },
 *    { name: 'database', stop: async () => prisma.$disconnect() },
 *  ]);
 *  ```
 */

import { performance } from 'node:perf_hooks';
import { logger } from '@/services/pino';
import type { Server } from 'node:http';

/**
 * Provides static methods for managing system lifecycle events,
 * ensuring predictable startup, graceful shutdown, and consistent logging.
 *
 * @remarks
 *  Intended to be used once at application bootstrap to manage all long-lived
 *  resources that require cleanup before process termination.
 */
export class SystemLifecycle {
  /** Internal flag to prevent redundant shutdown attempts. */
  private static shutdownStarted = false;

  /**
   * Registers OS signal listeners and orchestrates the shutdown of registered services.
   * Each service is stopped sequentially with duration tracking and structured logs.
   *
   * @param start - The performance timestamp marking application startup.
   * @param services - List of services to stop gracefully, each providing a name and stop function.
   *
   * @example
   *  SystemLifecycle.register(performance.now(), [
   *    { name: 'server', stop: async () => SystemLifecycle.closeServer(server) },
   *    { name: 'prisma', stop: async () => prisma.$disconnect() },
   *  ]);
   */
  public static register(
    start = performance.now(),
    services: Array<{ name: string; stop: () => Promise<void> | void }> = [],
  ): void {
    const context = 'SystemLifecycle';

    /**
     * Executes the graceful shutdown sequence.
     *
     * @param signal - The signal name triggering the shutdown (e.g. "SIGINT" or "SIGTERM").
     */
    const shutdown = async (signal: string): Promise<void> => {
      if (this.shutdownStarted) return;
      this.shutdownStarted = true;

      const initiated = performance.now();
      const uptime = (initiated - start).toFixed(2);

      logger.warn(
        { context, signal, uptime },
        `[exit] ${signal} received — initiating graceful shutdown`,
      );

      try {
        // Step 1 — Gracefully stop each registered service with timing.
        for (const service of services) {
          const started = performance.now();
          try {
            logger.info(
              { context, service: service.name },
              `[exit] stopping service: ${service.name}`,
            );
            await service.stop();

            const duration = (performance.now() - started).toFixed(2);
            logger.info(
              { context, service: service.name, duration },
              `[exit] service stopped in ${duration}ms`,
            );
          } catch (err) {
            const duration = (performance.now() - started).toFixed(2);
            logger.error(
              { context, service: service.name, duration, err },
              `[exit] failed to stop service after ${duration}ms`,
            );
          }
        }

        // Step 2 — Log overall shutdown duration and exit cleanly.
        const duration = (performance.now() - initiated).toFixed(2);
        logger.info({ context, duration }, `[exit] shutdown complete in ${duration}ms`);

        process.exit(0);
      } catch (err) {
        logger.error(
          {
            context,
            reason: err instanceof Error ? err.message : String(err),
          },
          '[exit] error during shutdown — forcing exit',
        );
        process.exit(1);
      }
    };

    // Register system signal handlers for graceful shutdown.
    ['SIGINT', 'SIGTERM'].forEach(sig => {
      process.once(sig, () => void shutdown(sig));
    });

    // Log uptime metrics before process termination.
    process.once('beforeExit', code => {
      const duration = (performance.now() - start).toFixed(2);
      logger.info({ context, code, duration }, `[exit] process exiting after ${duration}ms`);
    });
  }

  /**
   * Closes an HTTP server instance gracefully.
   * Returns a Promise that resolves once all connections are closed.
   *
   * @param server - The active Node.js HTTP server instance.
   * @returns Promise that resolves when the server has fully stopped.
   *
   * @example
   *  await SystemLifecycle.closeServer(server);
   */
  public static closeServer(server: Server): Promise<void> {
    const context = this.closeServer.name;

    return new Promise((resolve, reject) => {
      server.close(err => {
        if (err) {
          logger.error({ context, err }, '[exit] Failed to close HTTP server');
          return reject(err);
        }
        logger.info({ context }, '[exit] HTTP server closed');
        resolve();
      });
    });
  }
}
