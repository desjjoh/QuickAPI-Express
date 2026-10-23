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

/** The production service graph, kept separate from the process entrypoint for composition tests. */
export function createApplicationServices(): LifecycleService[] {
  return [
    {
      name: 'database (typeorm)',
      start: connectDatabase,
      stop: destroyDatabase,
      check: () => databaseReadiness.check(),
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
