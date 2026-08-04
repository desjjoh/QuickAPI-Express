import express, { Router } from 'express';

import items from './items/items.routes';

const router: Router = Router();
const v1: Router = express.Router();

v1.use('/', items);

router.use('/v1', v1);

export default router;
