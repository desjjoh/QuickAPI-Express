import { performance } from 'node:perf_hooks';

import { logger } from '@/config/pino.config';

type LifecycleService = {
  name: string;
  start?: () => Promise<void> | void;
  stop?: () => Promise<void> | void;
};

export class LifecycleHandler {
  private static startupServices: LifecycleService[] = [];
  private static shutdownServices: LifecycleService[] = [];

  private static startupStarted = false;
  private static shutdownStarted = false;

  public static register = (services: LifecycleService[]): void => {
    const start = performance.now();
    logger.debug(`Registering lifecycle services (${services.length} total)`);

    for (const service of services) {
      this.startupServices.push(service);
      this.shutdownServices.unshift(service);
    }

    this.registerListeners();

    const duration = (performance.now() - start).toFixed(2);
    logger.debug(`Lifecycle registration completed in ${duration}ms`);
  };

  public static startup = async (): Promise<void> => {
    if (this.startupStarted) return;
    this.startupStarted = true;

    const start = performance.now();
    logger.debug(`Starting services…`);

    for (const service of this.startupServices) {
      if (!service.start) continue;

      await service.start();
      logger.debug(`Service started → ${service.name}`);
    }

    const duration = (performance.now() - start).toFixed(2);
    logger.debug(`All services started in ${duration}ms`);
  };

  public static shutdown = async (): Promise<void> => {
    if (this.shutdownStarted) return;
    this.shutdownStarted = true;

    const start = performance.now();

    logger.debug('Stopping services…');

    for (const service of this.shutdownServices) {
      try {
        if (!service.stop) continue;
        await service.stop();
        logger.debug(`Service stopped ← ${service.name}`);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));

        logger.error({ error: error.stack }, `Failed to stop service → ${service.name}`);
      }
    }

    const duration = (performance.now() - start).toFixed(2);
    logger.debug(`Shutdown completed in ${duration}ms`);
  };

  private static registerListeners = (): void => {
    ['SIGINT', 'SIGTERM'].forEach((sig: string) => {
      process.once(sig, () => {
        logger.warn(`${sig} received — beginning shutdown`);
        this.shutdown();
      });
    });

    process.on('uncaughtException', (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));

      logger.fatal({ error: error.stack }, 'Uncaught exception — forcing exit');
      process.exit(1);
    });

    process.on('unhandledRejection', (reason: unknown) => {
      logger.fatal({ reason: String(reason) }, 'Unhandled promise rejection — forcing exit');
      process.exit(1);
    });

    process.on('exit', (code: number) => {
      logger.info(`Application exited cleanly (code ${code})`);
    });
  };
}
