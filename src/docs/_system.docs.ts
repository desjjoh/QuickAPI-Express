import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import {
  HealthResponseSchema,
  ReadyResponseSchema,
  InfoResponseSchema,
  SystemDiagnosticsSchema,
} from '@/models/system.model';

export const registerSystemPaths = (registry: OpenAPIRegistry) => {
  const tag = 'System';

  // GET /
  registry.registerPath({
    method: 'get',
    path: '/',
    tags: [tag],
    description: 'Root endpoint showing application greeting.',
    responses: {
      200: {
        description: 'Greeting message',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  example: 'Hello World! Welcome to Express.js',
                },
              },
              required: ['message'],
            },
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
    description:
      'Readiness check — verifies that the app has completed startup and all required services are healthy.',
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
      },
    },
  });

  // GET /info
  registry.registerPath({
    method: 'get',
    path: '/info',
    tags: [tag],
    description: 'Returns application metadata and runtime information.',
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
    description:
      'System diagnostics including memory usage, load averages, event loop lag, and database status.',
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
    description: 'Prometheus metrics in plaintext exposition format. Not JSON.',
    responses: {
      200: {
        description: 'Prometheus metrics (text/plain)',
      },
    },
  });
};
