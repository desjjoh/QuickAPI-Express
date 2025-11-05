/**
 * @fileoverview User entity validation and OpenAPI schemas.
 * @module api/schemas/user
 * @description
 *  Defines Zod schemas for validating and documenting user data across
 *  API routes. Includes base entity definition, input validation for
 *  create/update operations, and OpenAPI integration for documentation.
 *
 * @remarks
 *  - Extends Zod with OpenAPI support via `@asteasolutions/zod-to-openapi`.
 *  - Ensures all request/response types are strongly typed and reusable.
 *  - Used by `/users` routes for payload validation and response typing.
 *
 * @example
 *  import { CreateUserSchema } from '@/schemas/user';
 *  const payload = CreateUserSchema.parse({ name: 'John', email: 'john@example.com' });
 */

import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

/** Enable `.openapi()` extension methods for schema annotation. */
extendZodWithOpenApi(z);

/**
 * Base schema representing the User entity.
 * Used as the foundation for API responses and derived schemas.
 */
export const UserSchema = z.object({
  /** Unique user identifier (auto-increment integer). */
  id: z.number().int().openapi({ example: 1 }),

  /** Full name of the user. */
  name: z.string().openapi({ example: 'John Doe' }),

  /** Email address (must be a valid format). */
  email: z.string().email().openapi({ example: 'john@example.com' }),

  /** ISO 8601 creation timestamp. */
  createdAt: z.string().datetime().openapi({ example: '2025-10-29T14:30:00Z' }),
});

/**
 * Schema for creating a new user.
 * Requires `name` and `email` fields only.
 */
export const CreateUserSchema = UserSchema.pick({
  name: true,
  email: true,
}).openapi('CreateUserInput');

/**
 * Schema for updating an existing user.
 * Allows partial updates and validates that at least one field is provided.
 */
export const UpdateUserSchema = CreateUserSchema.partial()
  .refine(data => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update.',
  })
  .openapi('UpdateUserInput');

/**
 * Schema for returning a user entity in API responses.
 * Mirrors the full `UserSchema` definition.
 */
export const UserResponseSchema = UserSchema.openapi('UserResponse');

/**
 * Inferred type for user creation requests.
 * Used in controllers and service layers.
 */
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/**
 * Inferred type for user response objects.
 * Used for consistent return types across routes.
 */
export type UserResponse = z.infer<typeof UserResponseSchema>;
