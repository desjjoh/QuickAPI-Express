/**
 * @fileoverview Application lifecycle management and graceful shutdown handler.
 * @module system/lifecycle
 * @description
 *  Provides a structured mechanism to handle application startup and shutdown events.
 *  Ensures that open HTTP connections and Prisma database sessions are gracefully
 *  terminated upon receiving process signals (SIGINT, SIGTERM) or before process exit.
 *
 * @remarks
 *  - Prevents duplicate shutdown execution using a static guard flag.
 *  - Logs every shutdown step, including uptime and total shutdown duration.
 *  - Forces process termination with exit code 1 if cleanup fails.
 *
 * @example
 *  import { SystemLifecycle } from '@/system/lifecycle';
 *  import { app } from '@/app';
 *
 *  const server = app.listen(3000);
 *  SystemLifecycle.register(server);
 */

import { performance } from 'node:perf_hooks';
import { prisma } from '@/db/prisma';
import { logger } from '@/logger/logger';

/**
 * Handles system startup and shutdown coordination.
 * Ensures that key services (HTTP server, database, etc.) are
 * closed gracefully while preserving full observability through structured logs.
 */
export class SystemLifecycle {
  /** Flag to prevent multiple simultaneous shutdown attempts. */
  private static shutdownStarted = false;

  /**
   * Registers signal listeners and orchestrates a clean shutdown.
   *
   * @param server - The active HTTP server instance.
   * @param start - The performance timestamp marking app startup (default: current time).
   *
   * @example
   *  const start = performance.now();
   *  const server = app.listen(env.PORT);
   *  SystemLifecycle.register(server, start);
   */
  public static register(server: import('http').Server, start = performance.now()): void {
    const context = 'SystemLifecycle';

    /**
     * Executes the graceful shutdown procedure for all managed resources.
     *
     * @param signal - The triggering signal (e.g., "SIGINT", "SIGTERM").
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
        // Step 1 — Close HTTP server connections.
        await new Promise<void>((resolve, reject) => {
          server.close(err => {
            if (err) return reject(err);
            logger.info({ context }, '[exit] HTTP server closed');
            resolve();
          });
        });

        // Step 2 — Disconnect from Prisma-managed database connections.
        await prisma.$disconnect();
        logger.info({ context }, '[exit] Prisma disconnected');

        // Step 3 — Finalize and log shutdown duration.
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

    /**
     * Register operating system signal handlers (SIGINT, SIGTERM)
     * to trigger the graceful shutdown sequence.
     */
    ['SIGINT', 'SIGTERM'].forEach(sig => {
      process.once(sig, () => void shutdown(sig));
    });

    /**
     * Hook into Node’s `beforeExit` lifecycle event to log uptime
     * and the exit code before termination.
     */
    process.once('beforeExit', code => {
      const duration = (performance.now() - start).toFixed(2);
      logger.info({ context, code, duration }, `[exit] process exiting after ${duration}ms`);
    });
  }
}
