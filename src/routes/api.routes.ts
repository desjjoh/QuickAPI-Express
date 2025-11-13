import express from 'express';

import items from '@/controllers/items.controller';

const api = express.Router();

api.use('/items', items);

export default api;
