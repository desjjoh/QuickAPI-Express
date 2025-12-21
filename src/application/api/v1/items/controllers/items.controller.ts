import { Router, type Response } from 'express';

import { itemRepository as repo } from '@/database/repositories/item.repo';

import type { ValidatedRequest } from '@/library/types/request';

import { NotFoundError } from '@/common/exceptions/http.exception';
import type { Item } from '@/database/entities/item.entity';
import type { ListDTOParams } from '@/library/models/pagination.model';
import { validateRequest } from '@/common/middleware/validate-request.middleware';
import {
  toItemDTO,
  toItemListDTO,
  type ItemListResponse,
  type ItemResponse,
} from '../models/item.model';
import { IdParams, type IdRouteParams } from '@/library/models/parameters.model';
import { CreateItemSchema, type CreateItemInput } from '../models/item-create.model';
import { UpdateItemSchema, type UpdateItemInput } from '../models/item-update.model';
import {
  ItemPaginationQuerySchema,
  type ItemPaginationQuery,
} from '../models/pagination-query.model';

const router: Router = Router();

// POST /items
router.post(
  '/',
  validateRequest({ body: CreateItemSchema }),
  async (req: ValidatedRequest<null, null, CreateItemInput>, res: Response<ItemResponse>) => {
    const item: Item = await repo.create(req.validated!.body);

    res.status(201).json(toItemDTO(item));
  },
);

// GET /items
router.get(
  '/',
  validateRequest({ query: ItemPaginationQuerySchema }),
  async (
    req: ValidatedRequest<null, ItemPaginationQuery, null>,
    res: Response<ItemListResponse>,
  ) => {
    const pagination: ListDTOParams<Item> = await repo.get_many(req.validated!.query);

    res.json(toItemListDTO(pagination));
  },
);

// GET /items/:id
router.get(
  '/:id',
  validateRequest({ params: IdParams }),
  async (req: ValidatedRequest<IdRouteParams, null, null>, res: Response<ItemResponse>) => {
    const item: Item | null = await repo.get_by_id(req.validated!.params.id);
    if (!item) throw new NotFoundError('No item exists with the provided identifier.');

    res.json(toItemDTO(item));
  },
);

// PATCH /items/:id
router.patch(
  '/:id',
  validateRequest({ params: IdParams, body: UpdateItemSchema }),
  async (
    req: ValidatedRequest<IdRouteParams, null, UpdateItemInput>,
    res: Response<ItemResponse>,
  ) => {
    const item: Item | null = await repo.get_by_id(req.validated!.params.id);
    if (!item) throw new NotFoundError('No item exists with the provided identifier.');

    const updated: Item = await repo.update(item, req.validated!.body);

    res.json(toItemDTO(updated));
  },
);

// PUT /items/:id
router.put(
  '/:id',
  validateRequest({ params: IdParams, body: CreateItemSchema }),
  async (
    req: ValidatedRequest<IdRouteParams, null, CreateItemInput>,
    res: Response<ItemResponse>,
  ) => {
    const item: Item | null = await repo.get_by_id(req.validated!.params.id);
    if (!item) throw new NotFoundError('No item exists with the provided identifier.');

    const updated: Item = await repo.update(item, req.validated!.body);

    res.json(toItemDTO(updated));
  },
);

// DELETE /items/:id
router.delete(
  '/:id',
  validateRequest({ params: IdParams }),
  async (req: ValidatedRequest<IdRouteParams, null, null>, res: Response<ItemResponse>) => {
    const item: Item | null = await repo.get_by_id(req.validated!.params.id);
    if (!item) throw new NotFoundError('No item exists with the provided identifier.');

    const removed: Item = await repo.remove(item);

    res.json(toItemDTO(removed));
  },
);

export default router;
