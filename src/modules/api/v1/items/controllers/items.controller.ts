import { Router, type Response } from 'express';

import { itemRepository as repo } from '@/modules/domain/repositories/item.repo';
import type { ItemEntity } from '@/modules/domain/entities/_item.entity';

import type { ValidatedRequest } from '@/common/library/types/request';
import { NotFoundError } from '@/common/exceptions/http.exception';
import type { ListDTOParams } from '@/common/library/models/pagination.model';
import { validateRequest } from '@/common/middleware/validate-request.middleware';
import {
  toItemDTO,
  toItemListDTO,
  type ItemListResponse,
  type ItemResponse,
} from '../models/item.model';
import { IdParams, type IdRouteParams } from '@/common/library/models/parameters.model';

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
    const item: ItemEntity = await repo.create(req.validated!.body);

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
    const pagination: ListDTOParams<ItemEntity> = await repo.get_many(req.validated!.query);

    res.json(toItemListDTO(pagination));
  },
);

// GET /items/:id
router.get(
  '/:id',
  validateRequest({ params: IdParams }),
  async (req: ValidatedRequest<IdRouteParams, null, null>, res: Response<ItemResponse>) => {
    const item: ItemEntity | null = await repo.get_by_id(req.validated!.params.id);
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
    const item: ItemEntity | null = await repo.get_by_id(req.validated!.params.id);
    if (!item) throw new NotFoundError('No item exists with the provided identifier.');

    const updated: ItemEntity = await repo.update(item, req.validated!.body);

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
    const item: ItemEntity | null = await repo.get_by_id(req.validated!.params.id);
    if (!item) throw new NotFoundError('No item exists with the provided identifier.');

    const updated: ItemEntity = await repo.update(item, {
      ...req.validated!.body,
      description: req.validated!.body.description ?? null,
    });

    res.json(toItemDTO(updated));
  },
);

// DELETE /items/:id
router.delete(
  '/:id',
  validateRequest({ params: IdParams }),
  async (req: ValidatedRequest<IdRouteParams, null, null>, res: Response<ItemResponse>) => {
    const item: ItemEntity | null = await repo.get_by_id(req.validated!.params.id);
    if (!item) throw new NotFoundError('No item exists with the provided identifier.');

    const removed: ItemEntity = await repo.remove(item);

    res.json(toItemDTO(removed));
  },
);

export default router;
