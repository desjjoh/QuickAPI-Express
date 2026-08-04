import express, { Router } from 'express';

import system from './controllers/system.controller';

const router: Router = express.Router();

router.use('/', system);

export default router;
