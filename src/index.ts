import { logger } from '@/config/logger.config';
import { LC } from '@/common/handlers/lifecycle.handler';
import { createApplicationServices } from '@/application';

import { env, isDev } from '@/config/env.config';

async function bootstrap(): Promise<void> {
  const mode = isDev ? 'development' : 'production';
  logger.info(`Booting ${env.APP_NAME} v${env.APP_VERSION} (${mode}) — Node.js ${process.version}`);

  LC.register(createApplicationServices());

  await LC.startup();

  logger.info(`HTTP server running on port ${env.PORT} — http://localhost:${env.PORT}`);
}

void bootstrap().catch(async (err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ stack: error.stack }, `Error — ${error.message}`);

  logger.fatal('Fatal error during application bootstrap — initiating shutdown');
  await LC.shutdown(1);
});
