import { Router } from 'express';
import { validate } from '@/core/middleware/validate.js';
import { NotFoundError } from '@/core/utils/http-error.js';
import { prisma } from '@/services/prisma';
import { CreateUserSchema, UpdateUserSchema } from '@/api/schemas/user.schema';

const router = Router();

router.post('/', validate(CreateUserSchema), async (req, res) => {
  const { email, name } = req.body;

  const user = await prisma.user.create({
    data: { name, email },
  });

  res.status(201).json({ message: 'User created', user });
});

router.get('/', async (_req, res) => {
  const users = await prisma.user.findMany();
  res.json(users);
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return next(new NotFoundError('Invalid user ID'));

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return next(new NotFoundError('User not found'));

    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', validate(UpdateUserSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return next(new NotFoundError('Invalid user ID'));

    const updated = await prisma.user.update({
      where: { id },
      data: req.body,
    });

    res.json({ message: 'User updated', user: updated });
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025')
      return next(new NotFoundError('User not found'));

    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return next(new NotFoundError('Invalid user ID'));

    await prisma.user.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025')
      return next(new NotFoundError('User not found'));

    next(err);
  }
});

export default router;
