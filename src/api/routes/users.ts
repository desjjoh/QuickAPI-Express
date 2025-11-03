/**
 * @fileoverview User API routes.
 * @module routes/users
 * @description
 *  Defines RESTful CRUD endpoints for managing users.
 *  Integrates schema validation, structured error handling, and Prisma ORM operations.
 *
 * @remarks
 *  - Uses `validate()` middleware to enforce schema constraints via Zod.
 *  - Returns JSON responses with consistent structure and HTTP status codes.
 *  - Employs `NotFoundError` for missing or invalid user IDs.
 *  - Supports OpenAPI schema generation via associated Zod schemas.
 *
 * @example
 *  POST   /users        → Create a new user
 *  GET    /users        → Retrieve all users
 *  GET    /users/:id    → Retrieve a single user by ID
 *  PUT    /users/:id    → Update an existing user
 *  DELETE /users/:id    → Remove a user
 */

import { Router } from 'express';
import { validate } from '@/core/middleware/validate.js';
import { NotFoundError } from '@/core/utils/http-error.js';
import { prisma } from '@/services/prisma';
import { CreateUserSchema, UpdateUserSchema } from '@/api/schemas/user.schema';

const router = Router();

/**
 * Create a new user.
 *
 * @route POST /users
 * @group Users
 * @param {CreateUserInput.model} request.body.required - User creation payload
 * @returns {object} 201 - Created user object
 * @throws {400} If input validation fails
 *
 * @example
 *  curl -X POST http://localhost:3000/users \
 *  -H "Content-Type: application/json" \
 *  -d '{"name":"Alice","email":"alice@example.com"}'
 */
router.post('/', validate(CreateUserSchema), async (req, res) => {
  const { email, name } = req.body;

  const user = await prisma.user.create({
    data: { name, email },
  });

  res.status(201).json({ message: 'User created', user });
});

/**
 * Retrieve all users.
 *
 * @route GET /users
 * @group Users
 * @returns {Array<UserResponse>} 200 - List of all users
 */
router.get('/', async (_req, res) => {
  const users = await prisma.user.findMany();
  res.json(users);
});

/**
 * Retrieve a user by ID.
 *
 * @route GET /users/:id
 * @group Users
 * @param {number} id.path.required - User ID
 * @returns {UserResponse} 200 - The requested user
 * @throws {404} If user not found or ID is invalid
 */
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

/**
 * Update an existing user.
 *
 * @route PUT /users/:id
 * @group Users
 * @param {number} id.path.required - User ID
 * @param {UpdateUserInput.model} request.body.required - Fields to update
 * @returns {object} 200 - Updated user object
 * @throws {400} If payload is invalid
 * @throws {404} If user not found
 */
router.put('/:id', validate(UpdateUserSchema), async (req, res, next) => {
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

/**
 * Delete a user by ID.
 *
 * @route DELETE /users/:id
 * @group Users
 * @param {number} id.path.required - User ID
 * @returns {void} 204 - No Content (user deleted)
 * @throws {404} If user not found
 */
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

/** Default export — User API router. */
export default router;
