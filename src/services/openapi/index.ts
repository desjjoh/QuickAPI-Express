import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas30';
import { env } from '@/services/env-validation';
import { registerUserPaths } from './_users.openapi';
import { registerHealthPaths } from './_health.openapi';

const registry = new OpenAPIRegistry();

registerHealthPaths(registry);
registerUserPaths(registry);

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiSpec: OpenAPIObject = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'QuickAPI — Express',
    version: '1.0.0',
    description: 'Auto-generated documentation from Zod schemas',
  },
  servers: [{ url: `http://localhost:${env.PORT}` }],
});
