import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';

import { isDev } from '@/config/env-validation.config';
import { swaggerDocs } from '@/config/swagger.config';

import { errorHandler } from '@/middleware/error-handler.middleware';
import { httpLogger } from '@/middleware/http-logger.middleware';

import api_routes from '@/routes/api.routes';
import system_controller from '@/controllers/system.controller';
import { rootPath } from '@/config/paths.config';

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);

  app.use(httpLogger);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(
    cors({
      origin: ['*'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    }),
  );

  app.use(compression());

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: isDev ? 1000 : 200,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        status: 429,
        message: 'Too many requests — please slow down.',
      },
      handler: (req, res, _next, options) => {
        res.status(options.statusCode).json(options.message);
      },
    }),
  );

  const publicPath = path.join(rootPath, 'public');
  if (!fs.existsSync(publicPath)) fs.mkdirSync(publicPath, { recursive: true });

  app.use('/', system_controller);

  app.use('/api', api_routes);

  app.use('/docs', ...swaggerDocs);
  app.use('/public', express.static(publicPath));

  app.use(errorHandler);

  return app;
}
