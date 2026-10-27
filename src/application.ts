import {
  connectDatabase,
  destroyServer as destroyDatabase,
  databaseReadiness,
} from '@/config/database.config';
import {
  closeServer,
  isServerRunning,
  registerServer,
  beginServerShutdown,
} from '@/config/http-server.config';
import type { LifecycleService } from '@/common/handlers/lifecycle.handler';
import { IdempotencyCleanupService } from '@/common/services/idempotency-cleanup.service';

/** The production service graph, kept separate from the process entrypoint for composition tests. */
export function createApplicationServices(): LifecycleService[] {
  const cleanup = new IdempotencyCleanupService();

  return [
    {
      name: 'database (typeorm)',
      start: connectDatabase,
      stop: destroyDatabase,
      check: () => databaseReadiness.check(),
    },
    {
      name: 'idempotency cleanup',
      start: () => cleanup.start(),
      quiesce: () => cleanup.quiesce(),
      stop: () => cleanup.stop(),
    },
    {
      name: 'http server (express)',
      start: registerServer,
      quiesce: beginServerShutdown,
      stop: closeServer,
      check: isServerRunning,
    },
  ];
}
