import os from 'node:os';
import { Router, type Request, type Response } from 'express';

import { env } from '@/config/env.config';
import { isServerInitialized } from '@/config/database.config';
import { metricsRegistry } from '@/config/metrics.config';
import { getEventLoopLag } from '@/helpers/timer.helpers';
import { LifecycleHandler } from '@/handlers/lifecycle.handler';
import type { HealthResponse, InfoResponse, ReadyResponse } from '@/models/system.model';
import {
  toHealthDTO,
  toInfoDTO,
  toReadyDTO,
  toSystemDiagnosticsDTO,
} from '@/mappers/system.mapper';
import { ServiceUnavailableError } from '@/exceptions/http.exception';

const router = Router();

// GET /
router.get('/', (_req: Request, res: Response<{ message: string }>) => {
  res.json({ message: 'Hello World! Welcome to Express.js' });
});

// GET /health
router.get('/health', (_req: Request, res: Response<HealthResponse>) => {
  const alive = LifecycleHandler.isAlive();

  const uptime = process.uptime();
  const timestamp = new Date().toISOString();

  res.json(toHealthDTO({ alive, uptime, timestamp }));
});

// GET /ready
router.get('/ready', async (_req: Request, res: Response<ReadyResponse>) => {
  const appReady = LifecycleHandler.isReady();
  const servicesHealthy = await LifecycleHandler.areAllServicesHealthy();

  const ready = appReady && servicesHealthy;
  if (!ready) throw new ServiceUnavailableError('Application not ready');

  res.json(toReadyDTO({ ready }));
});

// GET /info
router.get('/info', async (_req: Request, res: Response<InfoResponse>) => {
  res.json(
    toInfoDTO({
      name: env.APP_NAME,
      version: env.APP_VERSION,
      environment: env.NODE_ENV,
      hostname: os.hostname(),
      pid: process.pid,
    }),
  );
});

// GET /system
router.get('/system', async (_req: Request, res: Response) => {
  const dbReady = isServerInitialized();
  const eventLoopLag = await getEventLoopLag();

  res.json(
    toSystemDiagnosticsDTO({
      uptime: process.uptime(),
      timestamp: Date.now(),
      eventLoopLag,
      db: dbReady ? 'connected' : 'disconnected',
    }),
  );
});

// GET /metrics
router.get('/metrics', async (_req: Request, res: Response) => {
  res.set('Content-Type', metricsRegistry.contentType);

  res.end(await metricsRegistry.metrics());
});

export default router;
