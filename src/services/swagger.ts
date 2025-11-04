/**
 * @fileoverview Swagger UI configuration.
 * @module services/swagger
 * @description
 *  Integrates Swagger UI with the application to provide interactive API documentation.
 *  Uses the OpenAPI specification generated and exported from `@/services/openapi`.
 *
 * @remarks
 *  - Exposes API documentation at the `/docs` route.
 *  - Automatically serves the latest OpenAPI schema.
 *  - Does not require manual UI setup — handled by `swagger-ui-express`.
 *
 * @example
 *  import { swaggerDocs } from "@/services/swagger";
 *  app.use("/docs", ...swaggerDocs);
 */

import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from '@/services/openapi';
import type { RequestHandler } from 'express';

/**
 * Swagger UI middleware pair for Express.
 *
 * @constant
 * @type {[RequestHandler[], RequestHandler]}
 * @description
 *  Serves the Swagger UI interface and OpenAPI specification.
 *  Spread this array directly into an Express route definition to expose
 *  the interactive API documentation endpoint.
 *
 * @example
 *  app.use("/docs", ...swaggerDocs);
 */
export const swaggerDocs: [RequestHandler[], RequestHandler] = [
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec),
];
