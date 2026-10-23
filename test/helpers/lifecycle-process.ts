import express from 'express';
import { createServer } from 'node:http';
import { LC } from '../../src/common/handlers/lifecycle.handler';
import { HttpListener } from '../../src/common/handlers/http-lifecycle.handler';
import {
  RequestWorkTracker,
  canRespond,
  trackHandler,
} from '../../src/common/handlers/request-lifecycle.handler';
import { requestTimeout } from '../../src/common/middleware/request-timeout.middleware';
import { errorHandler } from '../../src/common/middleware/error-handler.middleware';
import { env } from '../../src/config/env.config';
import { deferred, portOf } from './http';

const mode = process.argv[2];
const stuck = mode !== 'normal';
const release = deferred();
const work = new RequestWorkTracker();
const app = express();
let databaseOpen = false;
app.use(work.admit);
app.use(requestTimeout(env.REQUEST_TIMEOUT_MS));
app.get(
  '/',
  trackHandler(async (req: express.Request, res: express.Response) => {
    process.send?.({ type: 'started' });
    if (stuck) {
      setInterval(() => undefined, 1_000);
      await new Promise<void>(() => undefined);
    } else {
      await release.promise;
      process.send?.({ type: 'work-finished', databaseOpen });
      if (canRespond(req, res)) res.json({ databaseOpen });
    }
  }),
);
app.use(errorHandler);
const listener = new HttpListener(app, work, env);
const blocker = mode === 'bind-failure' ? createServer() : undefined;
if (blocker)
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
LC.register([
  {
    name: 'database fixture',
    start: () => {
      databaseOpen = true;
    },
    stop: async () => {
      process.send?.({ type: 'database-stop' });
      if (mode === 'stuck') await new Promise<void>(() => undefined);
      databaseOpen = false;
    },
  },
  {
    name: 'http',
    start: () => listener.start(blocker ? portOf(blocker) : 0, '127.0.0.1'),
    quiesce: () => listener.quiesce(),
    stop: () => listener.close(),
  },
]);

// Portable control exercises the registered SIGTERM handler on Windows too.
process.on('message', (message) => {
  if (message === 'release') release.resolve();
  if (message === 'shutdown') {
    process.emit('SIGTERM');
    process.send?.({ type: 'quiesced', ready: LC.isReady() });
    void LC.shutdown().then(() => process.disconnect());
  }
});

try {
  await LC.startup();
  process.send?.({ type: 'listening', port: portOf(listener.server) });
} catch (error) {
  process.send?.({
    type: 'startup-failed',
    databaseOpen,
    ready: LC.isReady(),
    code: (error as NodeJS.ErrnoException).code,
  });
  await listener.close();
  await new Promise<void>((resolve) => blocker!.close(() => resolve()));
  await LC.shutdown(1);
  process.disconnect();
}
