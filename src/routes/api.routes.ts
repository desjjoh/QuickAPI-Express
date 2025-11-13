import express from 'express';

import users from '@/controllers/users.controller';
import health from '@/controllers/health.controller';

const api = express.Router();

api.use('/', health);
api.use('/users', users);

export default api;
