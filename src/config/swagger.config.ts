import swaggerUi from 'swagger-ui-express';
import type { RequestHandler } from 'express';

import { openApiSpec } from '@/config/openapi.config';

export const swaggerDocs: [RequestHandler[], RequestHandler] = [
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec),
];
