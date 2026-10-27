import { Router } from 'express';
import { jsonHandler } from '@/common/handlers/http-response.handler';
import { validateRequest } from '@/common/middleware/validate-request.middleware';
import { IdParams } from '@/common/library/models/parameters.model';
import { itemService } from '../services/items.service';
import { toItemDTO, toItemListDTO } from '../models/item.model';
import { CreateItemSchema } from '../models/item-create.model';
import { ReplaceItemSchema } from '../models/item-replace.model';
import { VersionInputSchema } from '@/common/library/models/version.model';
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
    idempotency: {
      operation: 'items.create',
      scope: 'public',
      route: 'POST /api/v1/items',
    },
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
  jsonHandler(itemService.update, toItemDTO, {
    transaction: true,
    idempotency: {
      operation: 'items.update',
      scope: 'public',
      route: 'PATCH /api/v1/items/:id',
    },
  }),
);

// PUT /items/:id
router.put(
  '/:id',
  validateRequest({ params: IdParams, body: ReplaceItemSchema }),
  jsonHandler(itemService.replace, toItemDTO, {
    transaction: true,
    idempotency: {
      operation: 'items.replace',
      scope: 'public',
      route: 'PUT /api/v1/items/:id',
    },
  }),
);

// POST /items/:id/delete
router.post(
  '/:id/delete',
  validateRequest({ params: IdParams, body: VersionInputSchema }),
  jsonHandler(itemService.remove, toItemDTO, {
    transaction: true,
    idempotency: {
      operation: 'items.delete',
      scope: 'public',
      route: 'POST /api/v1/items/:id/delete',
    },
  }),
);

export default router;
