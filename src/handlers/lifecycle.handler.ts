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
    for (const service of services) {
      this.startupServices.push(service);
      this.shutdownServices.unshift(service);
    }

    ['SIGINT', 'SIGTERM'].forEach(sig => {
      process.once(sig, () => void this.shutdown(sig));
    });
  };

  public static startup = async (): Promise<void> => {
    if (this.startupStarted) return;
    this.startupStarted = true;

    const start = performance.now();

    try {
      for (const service of this.startupServices) {
        if (!service.start) continue;

        await service.start();
        logger.info(`↳ successfully started service → ${service.name}`);
      }

      const duration = (performance.now() - start).toFixed(2);
      logger.info(`Startup complete (${duration}ms)`);
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
        logger.info(`↳ successfully stopped service → ${service.name}`);
        await service.stop();
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));

        logger.error(`failed to stop service → ${service.name}`);
        throw error;
      }
    }

    const duration = (performance.now() - start).toFixed(2);
    logger.info(`Shutdown complete (${duration}ms)`);
    process.exit(0);
  };
}
