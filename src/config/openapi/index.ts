/**
 * @fileoverview OpenAPI specification generator.
 * @module config/openapi
 * @description
 *  Generates an OpenAPI v3 specification document from registered Zod schemas
 *  using `@asteasolutions/zod-to-openapi`. Combines all route definitions into a
 *  single unified API specification served through Swagger UI.
 *
 * @remarks
 *  - Automatically aggregates schema definitions from feature modules.
 *  - Keeps the OpenAPI spec synchronized with Zod validation logic.
 *  - Avoids manual OpenAPI YAML maintenance — generated dynamically at runtime.
 *
 * @example
 *  import { openApiSpec } from "@/config/openapi";
 *  console.log(openApiSpec.info.title); // "QuickAPI Express"
 */

import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas30';
import { env } from '@/core/config/env-validation';
import { registerUserPaths } from './_users.openapi';
import { registerHealthPaths } from './_health.openapi';

/**
 * Shared OpenAPI registry instance.
 *
 * Acts as a central registry for route definitions and schema references.
 * Feature modules (e.g., users, health) register their OpenAPI paths here.
 */
const registry = new OpenAPIRegistry();

/** Register all route-specific OpenAPI paths. */
registerHealthPaths(registry);
registerUserPaths(registry);

/**
 * OpenAPI document generator.
 *
 * Converts all registered definitions into a valid OpenAPI v3 document.
 */
const generator = new OpenApiGeneratorV3(registry.definitions);

/**
 * Generated OpenAPI specification document.
 *
 * @constant
 * @type {OpenAPIObject}
 * @description
 *  Auto-generated API specification derived from Zod schemas.
 *  Served at `/docs` via Swagger UI.
 */
export const openApiSpec: OpenAPIObject = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'QuickAPI Express',
    version: '1.0.0',
    description: 'Auto-generated documentation from Zod schemas',
  },
  servers: [{ url: `http://localhost:${env.PORT}` }],
});
