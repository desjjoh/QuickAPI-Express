import { performance } from 'node:perf_hooks';

import { logger } from '@/config/logger.config';

type LifecycleService = {
  name: string;
  check?: () => Promise<boolean> | boolean;
  start?: () => Promise<void> | void;
  stop?: () => Promise<void> | void;
};

class LifecycleHandler {
  private static startupServices: LifecycleService[] = [];
  private static initializedServices: LifecycleService[] = [];

  private static startupStarted: boolean = false;
  private static startupCompleted: boolean = false;

  private static shutdownStarted: boolean = false;

  public static isAlive(): boolean {
    return !this.shutdownStarted;
  }

  public static isReady(): boolean {
    return this.startupCompleted && !this.shutdownStarted;
  }

  public static async areAllServicesHealthy(): Promise<boolean> {
    for (const service of this.startupServices) {
      if (service.check) {
        let healthy: boolean;

        try {
          healthy = await service.check();
        } catch (err: unknown) {
          const error: Error = err instanceof Error ? err : new Error(String(err));
          logger.error({ stack: error.stack }, `Health check failed → ${service.name}`);
          return false;
        }

        if (!healthy) return false;
      }
    }

    return true;
  }

  public static register = (services: LifecycleService[]): void => {
    const start: number = performance.now();
    logger.debug(`Registering lifecycle services (${services.length} total)`);

    for (const service of services) {
      this.startupServices.push(service);
    }

    ['SIGINT', 'SIGTERM'].forEach((sig: string) => {
      process.once(sig, () => {
        logger.warn(`${sig} received — initiating shutdown`);
        void this.shutdown();
      });
    });

    this.registerInternalHandlers();

    const duration: string = (performance.now() - start).toFixed(2);
    logger.debug(`Lifecycle registration completed in ${duration}ms`);
  };

  private static registerInternalHandlers(): void {
    process.on('uncaughtException', (err: unknown) => {
      const error: Error = err instanceof Error ? err : new Error(String(err));
      logger.error({ stack: error.stack }, `Uncaught exception — ${error.message}`);

      logger.fatal('Fatal error caused by uncaught exception — initiating shutdown');
      void this.shutdown(1);
    });

    process.on('unhandledRejection', (reason: unknown) => {
      logger.error({ reason }, `Unhandled rejection — ${String(reason)}`);

      logger.fatal('Fatal error handling promise rejection — initiating shutdown');
      void this.shutdown(1);
    });

    process.on('exit', (code: number) => {
      logger.info(`Application exited (code ${code})`);
    });
  }

  public static startup = async (): Promise<void> => {
    if (this.startupStarted) return;
    this.startupStarted = true;

    const start: number = performance.now();
    logger.debug(`Starting services…`);

    try {
      for (const service of this.startupServices) {
        if (!service.start) continue;

        await service.start();
        this.initializedServices.push(service);
        logger.debug(`Service started → ${service.name}`);
      }
    } catch (err: unknown) {
      this.startupStarted = false;
      await this.stopInitializedServices();
      throw err;
    }

    this.startupCompleted = true;

    const duration: string = (performance.now() - start).toFixed(2);
    logger.debug(`All services started in ${duration}ms`);
  };

  private static async stopInitializedServices(): Promise<boolean> {
    let cleanupFailed: boolean = false;

    while (this.initializedServices.length > 0) {
      const service = this.initializedServices.pop();
      if (!service?.stop) continue;

      try {
        await service.stop();
        logger.debug(`Service stopped ← ${service.name}`);
      } catch (err: unknown) {
        cleanupFailed = true;
        const error: Error = err instanceof Error ? err : new Error(String(err));
        logger.error({ stack: error.stack }, `Error — ${error.message}`);
        logger.warn(`Failed to stop service → ${service.name}`);
      }
    }

    return cleanupFailed;
  }

  public static shutdown = async (exitCode: number = 0): Promise<void> => {
    const currentExitCode: number =
      typeof process.exitCode === 'number' ? process.exitCode : Number(process.exitCode ?? 0);
    process.exitCode = Math.max(currentExitCode, exitCode);
    if (this.shutdownStarted) return;
    this.shutdownStarted = true;
    this.startupCompleted = false;

    const start: number = performance.now();

    logger.debug('Stopping services…');

    const cleanupFailed: boolean = await this.stopInitializedServices();
    if (cleanupFailed) {
      process.exitCode = 1;
      logger.error('Shutdown completed with cleanup failures');
    }

    const duration: string = (performance.now() - start).toFixed(2);
    logger.debug(`Shutdown completed in ${duration}ms`);
  };
}

export const LC = LifecycleHandler;
