import { apiPath } from '@/helpers/path.helpers';
import { IdParams } from '@/models/parameters.model';
import {
  CreateItemSchema,
  ItemListResponseSchema,
  ItemResponseSchema,
  UpdateItemSchema,
} from '@/models/item.model';
import { PaginationQuerySchema } from '@/models/pagination.model';
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

export function registerItemPaths(registry: OpenAPIRegistry): void {
  const tag = 'Items';

  // POST /items
  registry.registerPath({
    method: 'post',
    path: apiPath('/items'),
    tags: [tag],
    summary: 'Create a new item',
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: CreateItemSchema },
        },
      },
    },
    responses: {
      201: {
        description: 'Item created successfully',
        content: {
          'application/json': {
            schema: ItemResponseSchema,
          },
        },
      },
    },
  });

  // GET /items
  registry.registerPath({
    method: 'get',
    path: apiPath('/items'),
    tags: [tag],
    summary: 'Get a list of items',
    request: {
      query: PaginationQuerySchema,
    },
    responses: {
      200: {
        description: 'List of items',
        content: {
          'application/json': {
            schema: ItemListResponseSchema,
          },
        },
      },
    },
  });

  // GET /items/{id}
  registry.registerPath({
    method: 'get',
    path: apiPath('/items/{id}'),
    tags: [tag],
    summary: 'Get a single item by ID',
    request: {
      params: IdParams,
    },
    responses: {
      200: {
        description: 'Item found',
        content: {
          'application/json': {
            schema: ItemResponseSchema,
          },
        },
      },
      404: { description: 'Item not found' },
    },
  });

  // PATCH /items/{id}
  registry.registerPath({
    method: 'patch',
    path: apiPath('/items/{id}'),
    tags: [tag],
    summary: 'Update an item by ID',
    request: {
      params: IdParams,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: UpdateItemSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Item updated successfully',
        content: {
          'application/json': {
            schema: ItemResponseSchema,
          },
        },
      },
      404: { description: 'Item not found' },
    },
  });

  // DELETE /items/{id}
  registry.registerPath({
    method: 'delete',
    path: apiPath('/items/{id}'),
    tags: [tag],
    summary: 'Delete an item by ID',
    request: {
      params: IdParams,
    },
    responses: {
      200: {
        description: 'Item deleted',
        content: {
          'application/json': {
            schema: ItemResponseSchema,
          },
        },
      },
      404: {
        description: 'Item not found',
      },
    },
  });
}
