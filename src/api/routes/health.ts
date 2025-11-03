/**
 * @fileoverview System health, readiness, and metrics endpoints.
 * @module routes/health
 * @description
 *  Exposes HTTP endpoints that report application status, database connectivity,
 *  and process metrics. Used by uptime monitors, orchestration probes, and
 *  operational dashboards.
 *
 * @remarks
 *  - `/health` verifies that the service is alive and responsive.
 *  - `/ready` confirms that dependencies (e.g., database) are reachable.
 *  - `/metrics` provides system resource usage for monitoring.
 *  - All endpoints return JSON responses compatible with Zod schemas in `@/schemas/health`.
 *
 * @example
 *  GET /health   → { "status": "ok", "uptime": 34.53, "timestamp": "2025-10-29T21:30:00Z" }
 *  GET /ready    → { "status": "ready", "db": "connected" }
 *  GET /metrics  → { "status": "ok", "uptime": 35.1, "rss": 8243200, "heapUsed": 3294720, "timestamp": "..." }
 */

import { Router } from 'express';
import { prisma } from '@/services/prisma';
import { logger } from '@/services/logger';

/** Express router instance containing all health and metrics endpoints. */
const router = Router();

/**
 * Health check endpoint.
 * Returns basic process liveness information including uptime and timestamp.
 *
 * @route GET /health
 * @returns 200 OK with status and uptime details.
 *
 * @example
 *  curl http://localhost:3000/health
 *  → { "status": "ok", "uptime": 123.45, "timestamp": "2025-10-29T21:30:00Z" }
 */
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date(),
  });
});

/**
 * Readiness probe endpoint.
 * Checks database connectivity to confirm the service is operational.
 *
 * @route GET /ready
 * @returns 200 OK if database responds, or 503 Service Unavailable if unreachable.
 *
 * @example
 *  curl http://localhost:3000/ready
 *  → { "status": "ready", "db": "connected" }
 */
router.get('/ready', async (_req, res) => {
  try {
    // Minimal lightweight connectivity check to confirm database health.
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', db: 'connected' });
  } catch (err) {
    logger.error({ err }, 'Database readiness check failed');
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

/**
 * Metrics endpoint.
 * Reports process-level performance metrics such as memory usage and uptime.
 * Useful for internal dashboards, Prometheus scraping, or debugging.
 *
 * @route GET /metrics
 * @returns 200 OK with process memory and uptime statistics.
 *
 * @example
 *  curl http://localhost:3000/metrics
 *  → { "status": "ok", "uptime": 67.89, "rss": 9328640, "heapUsed": 4821440, "timestamp": "..." }
 */
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

/** Default export — the router for health, readiness, and metrics routes. */
export default router;
