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
    logger.debug(`Initiating registration...`);

    for (const service of services) {
      this.startupServices.push(service);
      this.shutdownServices.unshift(service);
    }

    this.registerListeners();
    logger.debug(`↳ registered services: ${services.length}`);

    const duration = (performance.now() - start).toFixed(2);
    logger.debug(`↳ registration complete (${duration}ms)`);
  };

  public static startup = async (): Promise<void> => {
    if (this.startupStarted) return;
    this.startupStarted = true;

    const start = performance.now();
    logger.debug(`Initiating startup sequence...`);

    try {
      for (const service of this.startupServices) {
        if (!service.start) continue;

        await service.start();
        logger.debug(`↳ successfully started service → ${service.name}`);
      }

      const duration = (performance.now() - start).toFixed(2);
      logger.debug(`↳ startup complete (${duration}ms)`);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));

      await this.shutdown('STARTUP_FAILURE');
      throw error;
    }
  };

  public static shutdown = async (signal: string): Promise<void> => {
    if (this.shutdownStarted) return;
    this.shutdownStarted = true;

    const start = performance.now();

    logger.warn(`${signal} received — initiating graceful shutdown...`);

    for (const service of this.shutdownServices) {
      try {
        if (!service.stop) continue;
        await service.stop();
        logger.debug(`↳ successfully stopped service → ${service.name}`);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));

        logger.error({ error: error.stack }, `Failed to stop service → ${service.name}`);
      }
    }

    const duration = (performance.now() - start).toFixed(2);
    logger.debug(`↳ shutdown complete (${duration}ms)`);

    process.exit(0);
  };

  private static registerListeners = (): void => {
    ['SIGINT', 'SIGTERM'].forEach((sig: string) => {
      process.once(sig, () => void this.shutdown(sig));
    });

    process.on('uncaughtException', (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));

      logger.fatal({ error: error.stack }, 'Uncaught exception — forcing exit');
      process.exit(1);
    });

    process.on('unhandledRejection', (reason: unknown) => {
      logger.fatal(`Unhandled promise rejection: ${String(reason)}`);
      process.exit(1);
    });

    process.on('exit', (code: number) => {
      logger.info(`Application exited with code ${code}`);
    });
  };
}
