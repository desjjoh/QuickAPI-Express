/**
 * @fileoverview OpenAPI path registration for system health and metrics endpoints.
 * @module openapi/_health
 * @description
 *  Defines OpenAPI path specifications for core system monitoring endpoints,
 *  including `/health`, `/ready`, and `/metrics`. These routes provide
 *  operational insight for uptime, dependency readiness, and runtime performance.
 *
 * @remarks
 *  - Mirrors the Express routes defined in `/routes/health.ts`.
 *  - Uses Zod schemas from `@/schemas/system.schema` for validation and spec generation.
 *  - Designed for integration with orchestration probes (e.g., Kubernetes liveness/readiness).
 *
 * @example
 *  import { registerHealthPaths } from "@/config/_health.openapi";
 *  registerHealthPaths(registry);
 */

import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  HealthResponseSchema,
  ReadyResponseSchema,
  MetricsResponseSchema,
} from '@/api/schemas/system.schema';

/**
 * Registers all system health and metrics paths with the provided OpenAPI registry.
 *
 * @param {OpenAPIRegistry} registry - The OpenAPI registry to populate with health, readiness, and metrics endpoints.
 *
 * @returns {void}
 *
 * @description
 *  Registers the following paths:
 *  - GET `/health`: Reports basic uptime and service health.
 *  - GET `/ready`: Validates database and service readiness.
 *  - GET `/metrics`: Returns process metrics such as uptime and memory usage.
 */
export function registerHealthPaths(registry: OpenAPIRegistry): void {
  // Register reusable schema components
  registry.register('HealthResponse', HealthResponseSchema);
  registry.register('ReadyResponse', ReadyResponseSchema);
  registry.register('MetricsResponse', MetricsResponseSchema);

  // GET /health — Liveness Probe
  registry.registerPath({
    method: 'get',
    path: '/health',
    tags: ['System'],
    summary: 'Liveness probe',
    description: 'Returns basic service uptime information.',
    responses: {
      200: {
        description: 'Service is alive and responding.',
        content: {
          'application/json': { schema: HealthResponseSchema },
        },
      },
    },
  });

  // GET /ready — Readiness Probe
  registry.registerPath({
    method: 'get',
    path: '/ready',
    tags: ['System'],
    summary: 'Readiness probe',
    description: 'Checks if the database and core dependencies are available.',
    responses: {
      200: {
        description: 'Service is ready and dependencies are connected.',
        content: {
          'application/json': { schema: ReadyResponseSchema },
        },
      },
      503: {
        description: 'One or more dependencies are unavailable.',
        content: {
          'application/json': { schema: ReadyResponseSchema },
        },
      },
    },
  });

  // GET /metrics — Runtime Metrics
  registry.registerPath({
    method: 'get',
    path: '/metrics',
    tags: ['System'],
    summary: 'Basic process metrics',
    description: 'Returns uptime and memory usage for the service process.',
    responses: {
      200: {
        description: 'Metrics snapshot.',
        content: {
          'application/json': { schema: MetricsResponseSchema },
        },
      },
    },
  });
}
