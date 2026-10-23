import express, { Router } from 'express';

import items from './controllers/items.controller';
import { logRoute } from '@/common/helpers/request-log.helper';

const router: Router = express.Router();

router.use('/items', logRoute({ prefix: '/api/v1/items' }), items);

export default router;
