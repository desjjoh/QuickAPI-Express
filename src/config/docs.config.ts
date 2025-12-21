import swaggerUi from 'swagger-ui-express';
import type { RequestHandler } from 'express';
import Redoc from 'redoc-express';

import { env } from '@/config/env.config';

import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { registerSystemPaths } from '@/application/system/docs/system.docs';
import { registerItemPaths } from '@/application/api/v1/items/docs/items.docs';

const registry = new OpenAPIRegistry();

// System + diagnostics endpoints
registerSystemPaths(registry);

// Main API endpoints --
// V1 routes
registerItemPaths(registry);

// V2 routes

export const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiSpec = generator.generateDocument({
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

// Standard JSON endpoint
export const docsJson: RequestHandler = (_req, res) => {
  res.json(openApiSpec);
};

// Redoc endpoint using redoc-express
export const redocDocs: RequestHandler = Redoc({
  title: 'QuickAPI — ReDoc',
  specUrl: '/docs-json',
});
