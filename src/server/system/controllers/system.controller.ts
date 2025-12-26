import os from 'node:os';
import { Router, type Request, type Response } from 'express';

import { env } from '@/config/env.config';
import { isServerInitialized } from '@/config/database.config';
import { metricsRegistry } from '@/config/metrics.config';
import { getEventLoopLag } from '@/common/helpers/timer.helpers';
import { LC } from '@/common/handlers/lifecycle.handler';

import { ServiceUnavailableError } from '@/common/exceptions/http.exception';
import { type HealthResponse, toHealthDTO } from '../models/health.model';
import { type InfoResponse, toInfoDTO } from '../models/info.model';
import { type ReadyResponse, toReadyDTO } from '../models/ready.model';
import { toSystemDiagnosticsDTO } from '../models/system.model';
import { toRootDTO, type RootResponse } from '../models/root.model';

const router: Router = Router();

// GET /
router.get('/', (_req: Request, res: Response<RootResponse>) => {
  res.json(toRootDTO({ message: 'Hello World! Welcome to Express.js' }));
});

// GET /health
router.get('/health', (_req: Request, res: Response<HealthResponse>) => {
  const alive: boolean = LC.isAlive();

  const uptime: number = process.uptime();
  const timestamp: string = new Date().toISOString();

  res.json(toHealthDTO({ alive, uptime, timestamp }));
});

// GET /ready
router.get('/ready', async (_req: Request, res: Response<ReadyResponse>) => {
  const appReady: boolean = LC.isReady();
  const servicesHealthy: boolean = await LC.areAllServicesHealthy();

  const ready: boolean = appReady && servicesHealthy;
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
  const dbReady: boolean = isServerInitialized();
  const eventLoopLag: number = await getEventLoopLag();

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
