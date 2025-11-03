/**
 * @fileoverview Health, readiness, and metrics response schemas.
 * @module schemas/health
 * @description
 *  Defines structured Zod schemas for system health, readiness, and metrics endpoints.
 *  These schemas ensure that monitoring, orchestration, and client integrations receive
 *  consistent and well-typed responses across all environments.
 *
 * @remarks
 *  - Used by `/health`, `/ready`, and `/metrics` routes.
 *  - Each schema defines both shape and documentation metadata.
 *  - Compatible with OpenAPI and Zod-based runtime validation.
 *
 * @example
 *  import { HealthResponseSchema } from '@/schemas/health';
 *  const response = HealthResponseSchema.parse({
 *    status: 'ok',
 *    uptime: 123.45,
 *    timestamp: new Date().toISOString(),
 *  });
 */

import { z } from 'zod';

/**
 * Health check response schema.
 * Indicates basic liveness and service uptime.
 */
export const HealthResponseSchema = z.object({
  /** Fixed service state indicating operational status. */
  status: z.literal('ok'),

  /** Service uptime in seconds since process start. */
  uptime: z.number().describe('Service uptime in seconds'),

  /** ISO 8601 timestamp of when the check was executed. */
  timestamp: z.string().datetime(),
});

/**
 * Readiness check response schema.
 * Indicates whether the service and its dependencies are operational.
 */
export const ReadyResponseSchema = z.object({
  /** Overall readiness status (`ready` or `error`). */
  status: z.enum(['ready', 'error']),

  /** Database connectivity status. */
  db: z.enum(['connected', 'unreachable']),
});

/**
 * System metrics response schema.
 * Provides memory usage, uptime, and timestamp data for monitoring tools.
 */
export const MetricsResponseSchema = z.object({
  /** Fixed status value indicating a successful metrics read. */
  status: z.literal('ok'),

  /** Service uptime in seconds since process start. */
  uptime: z.number(),

  /** Resident Set Size — total memory used by the process. */
  rss: z.number().describe('Resident Set Size - total memory usage'),

  /** Heap memory currently allocated and in use. */
  heapUsed: z.number().describe('Heap memory currently in use'),

  /** ISO 8601 timestamp of when the metrics snapshot was generated. */
  timestamp: z.string().datetime(),
});
