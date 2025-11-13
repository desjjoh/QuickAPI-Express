import { Router, type Request, type Response } from 'express';
import {
  CreateUserSchema,
  UpdateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from '@/models/user.model';
import { validateRequest } from '@/middleware/validate-request.middleware';
import { IdParams, type IdRouteParams } from '@/models/id.model';

const router = Router();

router.post(
  '/',
  validateRequest({ body: CreateUserSchema }),
  async (req: Request<never, never, CreateUserInput>, res: Response) => {
    const { email, name } = req.body;

    res.status(201).json({ email, name });
  },
);

router.get('/', async (_req: Request, res: Response) => {
  res.json([]);
});

router.get(
  '/:id',
  validateRequest({ params: IdParams }),
  async (req: Request<IdRouteParams>, res: Response) => {
    const id = Number(req.params.id);
    res.json(id);
  },
);

router.patch(
  '/:id',
  validateRequest({ params: IdParams, body: UpdateUserSchema }),
  async (req: Request<IdRouteParams, never, UpdateUserInput>, res: Response) => {
    const id = Number(req.params.id);
    res.json(id);
  },
);

router.delete('/:id', async (req: Request<IdRouteParams>, res: Response) => {
  const id = Number(req.params.id);
  res.json(id);
});

export default router;
