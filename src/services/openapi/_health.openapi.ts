import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  HealthResponseSchema,
  ReadyResponseSchema,
  MetricsResponseSchema,
} from '@/api/schemas/system.schema';

export function registerHealthPaths(registry: OpenAPIRegistry): void {
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
