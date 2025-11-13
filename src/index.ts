import 'dotenv/config';

import { logger } from '@/config/pino.config';
import { connectDatabase, destroyServer } from '@/config/typeorm.config';

import { LifecycleHandler } from '@/handlers/lifecycle.handler';
import { HttpServerHandler } from '@/handlers/http-server.handler';

import { env, isDev } from '@/config/env-validation.config';

async function bootstrap(): Promise<void> {
  const { register, startup } = LifecycleHandler;
  const { registerServer, closeServer } = HttpServerHandler;

  const mode = isDev ? 'development' : 'production';

  logger.info(`Booting application (${mode}) — Node.js ${process.version}`);

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
