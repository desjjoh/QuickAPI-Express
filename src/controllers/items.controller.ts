import { Router, type Request, type Response } from 'express';
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
import { itemService } from '@/services/item.service';
import { toItemDTO, toItemListDTO } from '@/mappers/item.mapper';
import { PaginationQuerySchema, type PaginationQuery } from '@/models/pagination.model';

const router = Router();

// POST /items
router.post(
  '/',
  validateRequest({ body: CreateItemSchema }),
  async (req: Request<never, never, CreateItemInput>, res: Response<ItemResponse>) => {
    const item = await itemService.create(req.body);
    res.status(201).json(toItemDTO(item));
  },
);

// GET /items
router.get(
  '/',
  validateRequest({ query: PaginationQuerySchema }),
  async (req: Request<never, never, never, PaginationQuery>, res: Response<ItemListResponse>) => {
    const pagination = await itemService.list(req.query);
    res.json(toItemListDTO(pagination));
  },
);

// GET /items/:id
router.get(
  '/:id',
  validateRequest({ params: IdParams }),
  async (req: Request<IdRouteParams>, res: Response<ItemResponse>) => {
    const item = await itemService.get(Number(req.params.id));
    res.json(toItemDTO(item));
  },
);

// PATCH /items/:id
router.patch(
  '/:id',
  validateRequest({ params: IdParams, body: UpdateItemSchema }),
  async (req: Request<IdRouteParams, never, UpdateItemInput>, res: Response) => {
    const item = await itemService.update(Number(req.params.id), req.body);
    res.json(toItemDTO(item));
  },
);

// DELETE /items/:id
router.delete('/:id', async (req: Request<IdRouteParams>, res: Response<ItemResponse>) => {
  const item = await itemService.remove(Number(req.params.id));
  res.json(toItemDTO(item));
});

export default router;
