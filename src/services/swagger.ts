import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from '@/services/openapi';
import type { RequestHandler } from 'express';

export const swaggerDocs: [RequestHandler[], RequestHandler] = [
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec),
];
