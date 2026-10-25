import { Router } from 'express';
import { jsonHandler } from '@/common/handlers/http-response.handler';
import { validateRequest } from '@/common/middleware/validate-request.middleware';
import { IdParams } from '@/common/library/models/parameters.model';
import { itemService } from '../services/items.service';
import { toItemDTO, toItemListDTO } from '../models/item.model';
import { CreateItemSchema } from '../models/item-create.model';
import { UpdateItemSchema } from '../models/item-update.model';
import { ItemPaginationQuerySchema } from '../models/pagination-query.model';

const router: Router = Router();

// POST /items
router.post(
  '/',
  validateRequest({ body: CreateItemSchema }),
  jsonHandler(itemService.create, toItemDTO, {
    status: 201,
    transaction: true,
  }),
);

// GET /items
router.get(
  '/',
  validateRequest({ query: ItemPaginationQuerySchema }),
  jsonHandler(itemService.list, toItemListDTO),
);

// GET /items/:id
router.get(
  '/:id',
  validateRequest({ params: IdParams }),
  jsonHandler(itemService.get, toItemDTO),
);

// PATCH /items/:id
router.patch(
  '/:id',
  validateRequest({ params: IdParams, body: UpdateItemSchema }),
  jsonHandler(itemService.update, toItemDTO, { transaction: true }),
);

// PUT /items/:id
router.put(
  '/:id',
  validateRequest({ params: IdParams, body: CreateItemSchema }),
  jsonHandler(itemService.replace, toItemDTO, { transaction: true }),
);

// DELETE /items/:id
router.delete(
  '/:id',
  validateRequest({ params: IdParams }),
  jsonHandler(itemService.remove, toItemDTO, { transaction: true }),
);

export default router;
