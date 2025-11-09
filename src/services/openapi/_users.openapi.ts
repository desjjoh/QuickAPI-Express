import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { CreateUserSchema, UpdateUserSchema, UserResponseSchema } from '@/api/schemas/user.schema';
import { UserIdSchema } from '@/api/schemas/id.schema';

export function registerUserPaths(registry: OpenAPIRegistry): void {
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
