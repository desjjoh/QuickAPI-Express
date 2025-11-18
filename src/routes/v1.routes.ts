import express from 'express';

import items from '@/controllers/items.controller';

const v1 = express.Router();

v1.use('/items', items);

export default v1;
