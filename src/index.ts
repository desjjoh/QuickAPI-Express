import 'dotenv/config';

import { logger } from '@/config/logger.config';
import { connectDatabase, destroyServer } from '@/config/database.config';

import { LifecycleHandler } from '@/handlers/lifecycle.handler';
import { registerServer, closeServer } from '@/config/http-server.config';

import { env, isDev } from '@/config/env.config';

async function bootstrap(): Promise<void> {
  const { register, startup } = LifecycleHandler;

  const mode = isDev ? 'development' : 'production';
  const { APP_NAME, APP_VERSION } = env;
  logger.info(`Booting ${APP_NAME} v${APP_VERSION} (${mode}) — Node.js ${process.version}`);

  register([
    { name: 'database (typeorm)', start: connectDatabase, stop: destroyServer },
    { name: 'http server (express)', start: registerServer, stop: closeServer },
  ]);

  await startup();

  logger.info(`HTTP server running on port ${env.PORT} at http://localhost:${env.PORT}`);
}

bootstrap().catch(async (err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));

  logger.fatal({ error: error.stack }, 'Fatal error during application bootstrap — forcing exit');
  process.exit(1);
});
