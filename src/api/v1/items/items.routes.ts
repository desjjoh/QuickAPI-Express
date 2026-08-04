import express, { Router } from 'express';

import items from './controllers/items.controller';

const router: Router = express.Router();

router.use('/items', items);

export default router;
