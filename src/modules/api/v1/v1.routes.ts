import express, { Router } from 'express';

import items from './items/items.routes';

const v1: Router = express.Router();

v1.use('/', items);

export default v1;
