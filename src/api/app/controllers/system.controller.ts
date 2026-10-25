import { Router } from 'express';
import {
  jsonHandler,
  textHandler,
} from '@/common/handlers/http-response.handler';
import { metricsRegistry } from '@/config/metrics.config';
import { toHealthDTO } from '../models/health.model';
import { toInfoDTO } from '../models/info.model';
import { toReadyDTO, type ReadyResponse } from '../models/ready.model';
import { toSystemDiagnosticsDTO } from '../models/system.model';
import { toRootDTO } from '../models/root.model';
import { systemService } from '../services/system.service';

const router: Router = Router();

// GET /
router.get('/', jsonHandler(systemService.getRoot, toRootDTO));

// GET /health: no database dependency.
router.get('/health', jsonHandler(systemService.getHealth, toHealthDTO));

// GET /ready
router.get(
  '/ready',
  jsonHandler(systemService.getReady, toReadyDTO, {
    status: (body: ReadyResponse) => (body.ready ? 200 : 503),
  }),
);

// GET /info
router.get('/info', jsonHandler(systemService.getInfo, toInfoDTO));

// GET /system
router.get(
  '/system',
  jsonHandler(systemService.getSystemDiagnostics, toSystemDiagnosticsDTO),
);

// GET /metrics
router.get(
  '/metrics',
  textHandler(systemService.getMetrics, metricsRegistry.contentType),
);

export default router;
