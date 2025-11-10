import { createApp } from '@/app';

import { prisma } from '@/config/prisma.config';
import { env, isDev } from '@/config/env-validation.config';
import { logger } from '@/config/pino.config';

import { GracefulShutdown } from '@/handlers/graceful-shutdown.handler';

async function bootstrap(): Promise<void> {
  logger.info('Starting QuickAPI — Express...');
  logger.info(`  ↳ Node.js ${process.version} initialized`);

  const app = createApp();

  const { register, closeServer } = GracefulShutdown;

  register([
    { name: 'prisma', stop: async () => prisma.$disconnect() },
    { name: 'express', stop: async () => closeServer(server) },
  ]);

  const server = app.listen(env.PORT, () => {
    const mode = isDev ? 'development' : 'production';

    logger.info(`  ↳ HTTP server running in ${mode} mode at http://localhost:${env.PORT}`);
    logger.info(`  ↳ API documentation available at http://localhost:${env.PORT}/docs`);
  });
}

bootstrap().catch(() => {
  logger.fatal('Fatal error during application bootstrap');
  process.exit(1);
});
