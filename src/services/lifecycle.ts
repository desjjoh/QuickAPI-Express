import { performance } from 'node:perf_hooks';
import { logger } from '@/services/pino';
import type { Server } from 'node:http';

export class SystemLifecycle {
  private static shutdownStarted = false;

  public static register(
    services: Array<{ name: string; stop: () => Promise<void> | void }> = [],
  ): void {
    const shutdown = async (signal: string): Promise<void> => {
      if (this.shutdownStarted) return;
      this.shutdownStarted = true;

      const initiated = performance.now();
      logger.warn(`${signal} received — initiating graceful shutdown`);

      try {
        for (const service of services) {
          try {
            logger.info(`  - Stopping service → ${service.name}`);
            await service.stop();
          } catch {
            logger.error(`Failed to stop service: ${service.name}`);
          }
        }

        const duration = (performance.now() - initiated).toFixed(2);
        logger.info(`Shutdown completed in ${duration}ms`);

        process.exit(0);
      } catch {
        logger.fatal('Error during shutdown — forcing exit');
        process.exit(1);
      }
    };

    ['SIGINT', 'SIGTERM'].forEach(sig => {
      process.once(sig, () => void shutdown(sig));
    });
  }

  public static closeServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
      server.close(err => {
        if (err) {
          return reject(err);
        }

        resolve();
      });
    });
  }
}
