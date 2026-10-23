import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { SystemDiagnosticsSchema } from '../models/system.model';
import { HealthResponseSchema } from '../models/health.model';
import { InfoResponseSchema } from '../models/info.model';
import { ReadyResponseSchema } from '../models/ready.model';
import { RootResponseSchema } from '../models/root.model';

export const registerSystemPaths = (registry: OpenAPIRegistry) => {
  const tag = 'System';

  // GET /
  registry.registerPath({
    method: 'get',
    path: '/',
    tags: [tag],
    summary: 'Return a simple greeting message.',
    description: 'Root endpoint showing application greeting.',
    responses: {
      200: {
        description: 'Greeting message',
        content: {
          'application/json': {
            schema: RootResponseSchema,
          },
        },
      },
    },
  });

  // GET /health
  registry.registerPath({
    method: 'get',
    path: '/health',
    tags: [tag],
    summary: 'Report basic process liveness.',
    description: 'Liveness check — verifies the process is alive.',
    responses: {
      200: {
        description: 'Liveness information',
        content: {
          'application/json': {
            schema: HealthResponseSchema,
          },
        },
      },
    },
  });

  // GET /ready
  registry.registerPath({
    method: 'get',
    path: '/ready',
    tags: [tag],
    summary: 'Report application readiness state.',
    description:
      'Public readiness state only; dependency names and timings remain internal. Verifies startup and required services.',
    responses: {
      200: {
        description: 'Application is ready',
        content: {
          'application/json': {
            schema: ReadyResponseSchema,
          },
        },
      },
      503: {
        description: 'Application is not ready',
        content: {
          'application/json': {
            schema: ReadyResponseSchema,
          },
        },
      },
    },
  });

  // GET /info
  registry.registerPath({
    method: 'get',
    path: '/info',
    tags: [tag],
    summary: 'Return application and runtime metadata.',
    description:
      'Requires DIAGNOSTICS_ENABLED (disabled by default in production). Returns application metadata including name, version, environment, hostname, and PID.',
    responses: {
      200: {
        description: 'Application information',
        content: {
          'application/json': {
            schema: InfoResponseSchema,
          },
        },
      },
    },
  });

  // GET /system
  registry.registerPath({
    method: 'get',
    path: '/system',
    tags: [tag],
    summary: 'Return system-level diagnostics.',
    description:
      'Requires DIAGNOSTICS_ENABLED (disabled by default in production). Includes memory usage, load averages, event loop lag, and database status.',
    responses: {
      200: {
        description: 'System diagnostics snapshot',
        content: {
          'application/json': {
            schema: SystemDiagnosticsSchema,
          },
        },
      },
    },
  });

  // GET /metrics
  registry.registerPath({
    method: 'get',
    path: '/metrics',
    tags: [tag],
    summary: 'Expose Prometheus-formatted metrics.',
    description:
      'Requires METRICS_ENABLED (disabled by default in production) and deployment-level access restrictions. Prometheus plaintext, not JSON.',
    responses: {
      200: {
        description: 'Prometheus metrics (text/plain)',
        content: {
          'text/plain; version=0.0.4; charset=utf-8': {
            schema: {
              type: 'string',
              description: 'Prometheus text exposition format.',
            },
          },
        },
      },
    },
  });
};
