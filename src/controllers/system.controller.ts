import type { HealthResponse } from '@/models/system.model';
import { Router, type Request, type Response } from 'express';

const router = Router();

// GET /
router.get('/', (_req: Request, res: Response) => {
  res.json('Hello World! Welcome to Express.js');
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
