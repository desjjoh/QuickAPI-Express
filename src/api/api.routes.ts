import { Router } from 'express';

import system_routes from './app/app.routes';
import v1_routes from './v1/v1.routes';

const router: Router = Router();
const api_routes: Router = Router();

// VERSIONED ROUTES
api_routes.use('/', v1_routes);

// BASE ROUTER
router.use('/', system_routes);
router.use('/api', api_routes);

export default router;
