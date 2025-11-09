import { createApp } from '@/app';

import { prisma } from '@/services/prisma';
import { env, isDev } from '@/services/env-validation';
import { logger } from '@/services/pino';
import { SystemLifecycle } from '@/services/lifecycle';

async function bootstrap(): Promise<void> {
  logger.info('Starting QuickAPI — Express...');
  logger.info(`  ↳ Node.js ${process.version} initialized`);

  const app = createApp();

  SystemLifecycle.register([
    { name: 'server', stop: async () => SystemLifecycle.closeServer(server) },
    { name: 'prisma', stop: async () => prisma.$disconnect() },
  ]);

  const server = app.listen(env.PORT, () => {
    const mode = isDev ? 'development' : 'production';

    logger.info(`  ↳ HTTP server running in ${mode} mode at http://localhost:${env.PORT}`);
    logger.info(`  ↳ API documentation available at http://localhost:${env.PORT}/docs`);
  });
}

bootstrap().catch((err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));

  try {
    logger.fatal('Fatal error during application bootstrap');
  } catch {
    process.stderr.write(`Fatal error during bootstrap: ${error.message}\n`);
  }

  process.exit(1);
});
