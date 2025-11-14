import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas30';

import { registerItemPaths } from '@/docs/items.docs';
import { env } from './env-validation.config';
// import { registerHealthPaths } from '@/docs/system.docs';

const registry = new OpenAPIRegistry();

// System + diagnostics endpoints
// registerHealthPaths(registry);

// Main API endpoints
registerItemPaths(registry);

const generator = new OpenApiGeneratorV3(registry.definitions);

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
