import express, { Router } from 'express';

import items from './items/controllers/items.controller';

const v1: Router = express.Router();

v1.use('/items', items);

export default v1;
