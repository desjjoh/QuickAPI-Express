import { performance } from 'node:perf_hooks';
import { logger } from '@/services/pino';
import type { Server } from 'node:http';

export class SystemLifecycle {
  private static shutdownStarted = false;

  public static register(
    start = performance.now(),
    services: Array<{ name: string; stop: () => Promise<void> | void }> = [],
  ): void {
    const context = 'SystemLifecycle';

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

    ['SIGINT', 'SIGTERM'].forEach(sig => {
      process.once(sig, () => void shutdown(sig));
    });

    process.once('beforeExit', code => {
      const duration = (performance.now() - start).toFixed(2);
      logger.info({ context, code, duration }, `[exit] process exiting after ${duration}ms`);
    });
  }

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
