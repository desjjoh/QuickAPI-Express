import swaggerUi from 'swagger-ui-express';
import type { RequestHandler } from 'express';
import type { OpenAPIObject } from 'openapi3-ts/oas30';

import { env } from '@/config/env.config';
import { generator } from '@/docs';

export const openApiSpec: OpenAPIObject = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'QuickAPI — Express',
    version: env.APP_VERSION,
    description: 'Auto-generated documentation from Zod schemas',
  },
  servers: [
    {
      url: `http://localhost:${env.PORT}`,
      description: 'Primary application server.',
    },
  ],
});

export const swaggerDocs: [RequestHandler[], RequestHandler] = [
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec),
];
