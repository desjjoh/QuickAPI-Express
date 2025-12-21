import express, { Router } from 'express';

import v1_routes from './v1/v1.routes';

const api: Router = express.Router();

api.use('/v1', v1_routes);

export default api;
