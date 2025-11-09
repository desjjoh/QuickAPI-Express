import { Router } from 'express';
import { prisma } from '@/services/prisma';
import { logger } from '@/services/pino';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date(),
  });
});

router.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', db: 'connected' });
  } catch {
    logger.error('Database readiness check failed');
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

router.get('/metrics', (_req, res) => {
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
