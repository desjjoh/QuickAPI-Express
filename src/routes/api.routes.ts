import express from 'express';

import v1_routes from './v1.routes';

const api = express.Router();

api.use('/v1', v1_routes);

export default api;
