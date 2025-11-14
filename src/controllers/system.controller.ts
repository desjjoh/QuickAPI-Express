import os from 'node:os';
import { Router, type Request, type Response } from 'express';

import type { HealthResponse } from '@/models/system.model';
import { env } from '@/config/env-validation.config';
import { getEventLoopLag } from '@/helpers/timer.helpers';
import { AppDataSource } from '@/config/typeorm.config';

const router = Router();

// GET /
router.get('/', (_req: Request, res: Response<{ status: 'ok'; message: string }>) => {
  res.json({ status: 'ok', message: 'Hello World! Welcome to Express.js' });
});

// GET /health
router.get('/health', (_req: Request, res: Response<HealthResponse>) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// GET /ready
router.get('/ready', async (_req: Request, res: Response) => {
  try {
    res.json({ status: 'ready', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
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

  const dbReady = AppDataSource.isInitialized;

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
router.get('/metrics', (_req: Request, res: Response) => {
  const memory = process.memoryUsage();
  const uptime = process.uptime();

  res.json({
    status: 'ok',
    uptime,
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    timestamp: new Date(),
  });
});

export default router;
