import { createApplicationServices } from '../../src/application';
import { createApp } from '../../src/config/http-server.config';
import { AppDataSource } from '../../src/config/database.config';
import { env } from '../../src/config/env.config';
import { LC } from '../../src/common/handlers/lifecycle.handler';
import { HttpListener } from '../../src/common/handlers/http-lifecycle.handler';
import { RequestWorkTracker } from '../../src/common/handlers/request-lifecycle.handler';
import { IdempotencyCleanupService } from '../../src/common/services/idempotency-cleanup.service';
import { IdempotencyRepository } from '../../src/database/repositories/idempotency.repo';
import { itemRepository } from '../../src/database/repositories/item.repo';
import { assertSafeTestDatabase } from './database/safety';
import { deferred, portOf } from './http';
import express from 'express';
import type { Socket } from 'node:net';

assertSafeTestDatabase();
const mode = process.argv[2];
let responseSocket: Socket | undefined;
if (mode === 'lost-response') {
  const createRunner = IdempotencyRepository.prototype.createQueryRunner;
  IdempotencyRepository.prototype.createQueryRunner = function () {
    const runner = createRunner.call(this);
    const commit = runner.commitTransaction.bind(runner);
    runner.commitTransaction = async () => {
      await commit();
      responseSocket?.destroy();
      process.send?.({ type: 'committed-without-response' });
    };
    return runner;
  };
}
const release = deferred();
const cleanupRelease = deferred();
let sweepCleanup: () => Promise<void>;
const start = IdempotencyCleanupService.prototype.start;
IdempotencyCleanupService.prototype.start = function () {
  sweepCleanup = this.sweep.bind(this);
  start.call(this);
};
if (mode === 'hold' || mode === 'crash') {
  const create = itemRepository.create.bind(itemRepository);
  itemRepository.create = async (...args) => {
    const item = await create(...args);
    process.send?.({ type: 'work-started' });
    await release.promise;
    return item;
  };
}
if (mode === 'cleanup' || mode === 'stuck-cleanup') {
  const purge = IdempotencyRepository.prototype.purgeExpiredBatch;
  IdempotencyRepository.prototype.purgeExpiredBatch = async function (limit) {
    process.send?.({ type: 'cleanup-started' });
    await cleanupRelease.promise;
    const result = await purge.call(this, limit);
    process.send?.({
      type: 'cleanup-finished',
      databaseOpen: AppDataSource.isInitialized,
    });
    return result;
  };
}
const work = new RequestWorkTracker();
const app = express();
app.use((req, _res, next) => {
  responseSocket = req.socket;
  next();
});
app.use(createApp(env, work));
const listener = new HttpListener(app, work, env);
const services = createApplicationServices().map((service) =>
  service.name === 'http server (express)'
    ? {
        ...service,
        start: () => listener.start(0, '127.0.0.1'),
        quiesce: () => listener.quiesce(),
        stop: () => listener.close(),
        check: () => listener.isRunning(),
      }
    : service.name === 'database (typeorm)'
      ? {
          ...service,
          stop: async () => {
            await service.stop?.();
            process.send?.({ type: 'database-stopped' });
          },
        }
      : service,
);
LC.register(services);
process.on('message', (message) => {
  if (message === 'release') release.resolve();
  if (message === 'release-cleanup') cleanupRelease.resolve();
  if (message === 'sweep')
    void sweepCleanup()
      .then(() => process.send?.({ type: 'swept' }))
      .catch((error) => {
        throw error;
      });
  if (message === 'shutdown') {
    process.emit('SIGTERM');
    process.send?.({ type: 'quiesced', ready: LC.isReady() });
    void LC.shutdown().then(() => process.disconnect());
  }
});
await LC.startup();
process.send?.({ type: 'listening', port: portOf(listener.server) });
