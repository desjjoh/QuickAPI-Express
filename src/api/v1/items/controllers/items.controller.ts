import {
  trackHandler,
  canRespond,
} from '@/common/handlers/request-lifecycle.handler';
import { Router, type Response } from 'express';

import { itemRepository as repo } from '@/database/repositories/item.repo';
import type { ItemEntity } from '@/database/entities/_item.entity';

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
import {
  IdParams,
  type IdRouteParams,
} from '@/common/library/models/parameters.model';

import {
  CreateItemSchema,
  type CreateItemInput,
} from '../models/item-create.model';
import {
  UpdateItemSchema,
  type UpdateItemInput,
} from '../models/item-update.model';
import {
  ItemPaginationQuerySchema,
  type ItemPaginationQuery,
} from '../models/pagination-query.model';

const router: Router = Router();

// POST /items
router.post(
  '/',
  validateRequest({ body: CreateItemSchema }),
  trackHandler(
    async (
      req: ValidatedRequest<null, null, CreateItemInput>,
      res: Response<ItemResponse>,
    ) => {
      const item: ItemEntity = await repo.create(req.validated!.body);

      if (!canRespond(req, res)) return;

      res.status(201).json(toItemDTO(item));
    },
  ),
);

// GET /items
router.get(
  '/',
  validateRequest({ query: ItemPaginationQuerySchema }),
  trackHandler(
    async (
      req: ValidatedRequest<null, ItemPaginationQuery, null>,
      res: Response<ItemListResponse>,
    ) => {
      const pagination: ListDTOParams<ItemEntity> = await repo.get_many(
        req.validated!.query,
      );

      if (!canRespond(req, res)) return;

      res.json(toItemListDTO(pagination));
    },
  ),
);

// GET /items/:id
router.get(
  '/:id',
  validateRequest({ params: IdParams }),
  trackHandler(
    async (
      req: ValidatedRequest<IdRouteParams, null, null>,
      res: Response<ItemResponse>,
    ) => {
      const item: ItemEntity | null = await repo.get_by_id(
        req.validated!.params.id,
      );

      if (!canRespond(req, res)) return;

      if (!item)
        throw new NotFoundError('No item exists with the provided identifier.');

      if (!canRespond(req, res)) return;

      res.json(toItemDTO(item));
    },
  ),
);

// PATCH /items/:id
router.patch(
  '/:id',
  validateRequest({ params: IdParams, body: UpdateItemSchema }),
  trackHandler(
    async (
      req: ValidatedRequest<IdRouteParams, null, UpdateItemInput>,
      res: Response<ItemResponse>,
    ) => {
      const item: ItemEntity | null = await repo.get_by_id(
        req.validated!.params.id,
      );

      if (!canRespond(req, res)) return;

      if (!item)
        throw new NotFoundError('No item exists with the provided identifier.');

      const updated: ItemEntity = await repo.update(item, req.validated!.body);

      if (!canRespond(req, res)) return;

      res.json(toItemDTO(updated));
    },
  ),
);

// PUT /items/:id
router.put(
  '/:id',
  validateRequest({ params: IdParams, body: CreateItemSchema }),
  trackHandler(
    async (
      req: ValidatedRequest<IdRouteParams, null, CreateItemInput>,
      res: Response<ItemResponse>,
    ) => {
      const item: ItemEntity | null = await repo.get_by_id(
        req.validated!.params.id,
      );

      if (!canRespond(req, res)) return;

      if (!item)
        throw new NotFoundError('No item exists with the provided identifier.');

      const updated: ItemEntity = await repo.update(item, {
        ...req.validated!.body,
        description: req.validated!.body.description ?? null,
      });

      if (!canRespond(req, res)) return;

      res.json(toItemDTO(updated));
    },
  ),
);

// DELETE /items/:id
router.delete(
  '/:id',
  validateRequest({ params: IdParams }),
  trackHandler(
    async (
      req: ValidatedRequest<IdRouteParams, null, null>,
      res: Response<ItemResponse>,
    ) => {
      const item: ItemEntity | null = await repo.get_by_id(
        req.validated!.params.id,
      );

      if (!canRespond(req, res)) return;

      if (!item)
        throw new NotFoundError('No item exists with the provided identifier.');

      const removed: ItemEntity = await repo.remove(item);

      if (!canRespond(req, res)) return;

      res.json(toItemDTO(removed));
    },
  ),
);

export default router;
