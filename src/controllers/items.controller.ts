import { Router, type Response } from 'express';
import {
  CreateItemSchema,
  UpdateItemSchema,
  type CreateItemInput,
  type ItemListResponse,
  type ItemResponse,
  type UpdateItemInput,
} from '@/models/item.model';
import { IdParams, type IdRouteParams } from '@/models/parameters.model';
import { validateRequest } from '@/middleware/validate-request.middleware';
import { itemRepository } from '@/repositories/item.repo';
import { toItemDTO, toItemListDTO } from '@/mappers/item.mapper';
import { PaginationQuerySchema, type PaginationQuery } from '@/models/pagination.model';
import type { ValidatedRequest } from '@/types/request';

const router = Router();

// POST /items
router.post(
  '/',
  validateRequest({ body: CreateItemSchema }),
  async (req: ValidatedRequest<null, null, CreateItemInput>, res: Response<ItemResponse>) => {
    const item = await itemRepository.create(req.validated!.body);

    res.status(201).json(toItemDTO(item));
  },
);

// GET /items
router.get(
  '/',
  validateRequest({ query: PaginationQuerySchema }),
  async (req: ValidatedRequest<null, PaginationQuery, null>, res: Response<ItemListResponse>) => {
    const pagination = await itemRepository.list(req.validated!.query);

    res.json(toItemListDTO(pagination));
  },
);

// GET /items/:id
router.get(
  '/:id',
  validateRequest({ params: IdParams }),
  async (req: ValidatedRequest<IdRouteParams, null, null>, res: Response<ItemResponse>) => {
    const item = await itemRepository.get(req.validated!.params.id);

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
    const item = await itemRepository.update(req.validated!.params.id, req.validated!.body);

    res.json(toItemDTO(item));
  },
);

// DELETE /items/:id
router.delete(
  '/:id',
  validateRequest({ params: IdParams }),
  async (req: ValidatedRequest<IdRouteParams, null, null>, res: Response<ItemResponse>) => {
    const item = await itemRepository.remove(req.validated!.params.id);

    res.json(toItemDTO(item));
  },
);

export default router;
