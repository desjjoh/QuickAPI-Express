import 'dotenv/config';

import { logger } from '@/config/logger.config';
import { connectDatabase, destroyServer, isServerInitialized } from '@/config/database.config';

import { LC } from '@/handlers/lifecycle.handler';
import { registerServer, closeServer, isServerRunning } from '@/config/http-server.config';

import { env, isDev } from '@/config/env.config';

async function bootstrap(): Promise<void> {
  const mode = isDev ? 'development' : 'production';
  logger.info(`Booting ${env.APP_NAME} v${env.APP_VERSION} (${mode}) — Node.js ${process.version}`);

  LC.register([
    {
      name: 'database (typeorm)',
      start: connectDatabase,
      stop: destroyServer,
      check: isServerInitialized,
    },
    {
      name: 'http server (express)',
      start: registerServer,
      stop: closeServer,
      check: isServerRunning,
    },
  ]);

  await LC.startup();

  logger.info(`HTTP server running on port ${env.PORT} — http://localhost:${env.PORT}`);
}

bootstrap().catch(async (err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ stack: error.stack }, `Error — ${error.message}`);

  logger.fatal('Fatal error during application bootstrap — forcing exit');
  process.exit(1);
});
