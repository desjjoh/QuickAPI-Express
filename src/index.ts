import 'reflect-metadata';
import 'dotenv/config';

import { logger } from '@/config/pino.config';
import { connectDatabase, destroyServer } from '@/config/typeorm.config';

import { LifecycleHandler } from '@/handlers/lifecycle.handler';
import { HttpServerHandler } from '@/handlers/http-server.handler';

async function bootstrap(): Promise<void> {
  const { register, startup } = LifecycleHandler;
  const { registerServer, closeServer } = HttpServerHandler;

  register([
    { name: 'typeorm', start: connectDatabase, stop: destroyServer },
    { name: 'express', start: registerServer, stop: closeServer },
  ]);

  await startup();
}

bootstrap().catch(async (err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));

  logger.fatal({ error: error.stack }, 'Fatal error during application bootstrap');
  process.exit(1);
});
