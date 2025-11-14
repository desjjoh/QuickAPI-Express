import os from 'node:os';
import { Router, type Request, type Response } from 'express';

import { env } from '@/config/env.config';
import { isServerInitialized } from '@/config/database.config';
import { metricsRegistry } from '@/config/metrics.config';

import { getEventLoopLag } from '@/helpers/timer.helpers';
import { LifecycleHandler } from '@/handlers/lifecycle.handler';

const router = Router();

// GET /
router.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Hello World! Welcome to Express.js' });
});

// GET /health
router.get('/health', (_req: Request, res: Response) => {
  const alive = LifecycleHandler.isAlive();

  res.json({
    alive,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// GET /ready
router.get('/ready', async (_req: Request, res: Response) => {
  const appReady = LifecycleHandler.isReady();
  const dbReady = isServerInitialized();

  const ready = appReady && dbReady;

  if (!ready) {
    return res.status(503).json({
      ready: false,
      appReady,
      dbReady,
    });
  }

  res.json({ ready: true });
});

// GET /info
router.get('/info', async (_req: Request, res: Response) => {
  res.json({
    name: env.APP_NAME,
    version: env.APP_VERSION,
    environment: env.NODE_ENV,
    hostname: os.hostname(),
    pid: process.pid,
  });
});

// GET /system
router.get('/system', async (_req: Request, res: Response) => {
  const memory = process.memoryUsage();
  const load = os.loadavg();

  const dbReady = isServerInitialized();

  const eventLoopLag = await getEventLoopLag();

  res.json({
    uptime: process.uptime(),
    timestamp: Date.now(),

    memory,
    load,
    eventLoopLag,

    db: dbReady ? 'connected' : 'disconnected',
  });
});

// GET /metrics
router.get('/metrics', async (_req: Request, res: Response<string>) => {
  res.set('Content-Type', metricsRegistry.contentType);

  res.end(await metricsRegistry.metrics());
});

export default router;
