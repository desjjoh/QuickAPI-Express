/**
 * @fileoverview OpenAPI path registration for User routes.
 * @module openapi/_users
 * @description
 *  Defines and registers all OpenAPI-compliant path definitions for user-related endpoints.
 *  These definitions are consumed by `@asteasolutions/zod-to-openapi` to generate the
 *  full API specification document dynamically.
 *
 * @remarks
 *  - Each route mirrors the actual Express endpoints in `/routes/users.ts`.
 *  - Schemas are linked via `$ref` to maintain consistency with runtime validation.
 *  - All responses use JSON content types with schema references.
 *
 * @example
 *  import { registerUserPaths } from "@/services/openapi/_users.openapi";
 *  registerUserPaths(registry);
 */

import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { CreateUserSchema, UpdateUserSchema, UserResponseSchema } from '@/api/schemas/user.schema';
import { UserIdSchema } from '@/api/schemas/id.schema';

/**
 * Registers all user-related API paths in the provided OpenAPI registry.
 *
 * @param {OpenAPIRegistry} registry - The central OpenAPI registry to which
 *  all user endpoint definitions will be attached.
 *
 * @returns {void}
 *
 * @description
 *  The function registers CRUD paths for the `/users` resource, including:
 *  - POST `/users`: Create a user
 *  - GET `/users`: Retrieve all users
 *  - GET `/users/{id}`: Retrieve a user by ID
 *  - PATCH `/users/{id}`: Update a user
 *  - DELETE `/users/{id}`: Delete a user
 */
export function registerUserPaths(registry: OpenAPIRegistry): void {
  // Register component schemas
  registry.register('User', UserResponseSchema);
  registry.register('CreateUser', CreateUserSchema);
  registry.register('UserId', UserIdSchema);
  registry.register('UpdateUser', UpdateUserSchema);

  // POST /users
  registry.registerPath({
    method: 'post',
    path: '/users',
    tags: ['Users'],
    summary: 'Create a new user',
    request: {
      body: {
        content: {
          'application/json': { schema: CreateUserSchema },
        },
      },
    },
    responses: {
      201: {
        description: 'User created successfully',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/User' },
          },
        },
      },
      400: { description: 'Validation error' },
    },
  });

  // GET /users
  registry.registerPath({
    method: 'get',
    path: '/users',
    tags: ['Users'],
    summary: 'Get all users',
    responses: {
      200: {
        description: 'List of users',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/User' },
            },
          },
        },
      },
    },
  });

  // GET /users/{id}
  registry.registerPath({
    method: 'get',
    path: '/users/{id}',
    tags: ['Users'],
    summary: 'Get a single user by ID',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { $ref: '#/components/schemas/UserId' },
      },
    ],
    responses: {
      200: {
        description: 'User found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/User' },
          },
        },
      },
      404: { description: 'User not found' },
    },
  });

  // PATCH /users/{id}
  registry.registerPath({
    method: 'patch',
    path: '/users/{id}',
    tags: ['Users'],
    summary: 'Update a user',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { $ref: '#/components/schemas/UserId' },
      },
    ],
    request: {
      body: {
        content: {
          'application/json': { schema: UpdateUserSchema },
        },
      },
    },
    responses: {
      200: {
        description: 'User updated successfully',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/User' },
          },
        },
      },
      404: { description: 'User not found' },
    },
  });

  // DELETE /users/{id}
  registry.registerPath({
    method: 'delete',
    path: '/users/{id}',
    tags: ['Users'],
    summary: 'Delete a user by ID',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { $ref: '#/components/schemas/UserId' },
      },
    ],
    responses: {
      204: { description: 'User deleted successfully (no content)' },
      404: { description: 'User not found' },
    },
  });
}
