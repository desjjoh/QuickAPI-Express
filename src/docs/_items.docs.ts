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
import { ErrorResponseSchema } from '@/models/error.model';

export function registerItemPaths(registry: OpenAPIRegistry): void {
  const tag = 'Items';

  // GET /items
  registry.registerPath({
    method: 'get',
    path: apiPath('/items'),
    tags: [tag],
    summary: 'Get a list of items',
    description:
      'Retrieves a paginated list of items. Supports page, limit, sorting, and optional filtering.',
    request: {
      query: PaginationQuerySchema,
    },
    responses: {
      200: {
        description: 'Successful Response',
        content: {
          'application/json': {
            schema: ItemListResponseSchema,
          },
        },
      },
    },
  });

  // POST /items
  registry.registerPath({
    method: 'post',
    path: apiPath('/items'),
    tags: [tag],
    summary: 'Create a new item',
    description:
      'Creates a new item using validated input. Returns the fully normalized item resource after persistence.',
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
        description: 'Successful Response',
        content: {
          'application/json': {
            schema: ItemResponseSchema,
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
    description:
      'Fetches a single item by its unique identifier. Returns 404 if the item does not exist.',
    request: {
      params: IdParams,
    },
    responses: {
      200: {
        description: 'Successful Response',
        content: {
          'application/json': {
            schema: ItemResponseSchema,
          },
        },
      },
      404: {
        description: 'Item not found',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  });

  // PATCH /items/{id}
  registry.registerPath({
    method: 'patch',
    path: apiPath('/items/{id}'),
    tags: [tag],
    summary: 'Update an item by ID',
    description:
      'Applies a partial update to an existing item. Only provided fields are modified. Returns the updated resource.',
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
        description: 'Successful Response',
        content: {
          'application/json': {
            schema: ItemResponseSchema,
          },
        },
      },
      404: {
        description: 'No item exists with the provided identifier.',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  });

  // PUT /items/{id}
  registry.registerPath({
    method: 'put',
    path: apiPath('/items/{id}'),
    tags: [tag],
    summary: 'Replace an item by ID',
    description:
      'Replaces an existing item with the provided data. All fields must be supplied. Returns the updated resource.',
    request: {
      params: IdParams,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: CreateItemSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successful Response',
        content: {
          'application/json': {
            schema: ItemResponseSchema,
          },
        },
      },
      404: {
        description: 'No item exists with the provided identifier.',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  });

  // DELETE /items/{id}
  registry.registerPath({
    method: 'delete',
    path: apiPath('/items/{id}'),
    tags: [tag],
    summary: 'Delete an item by ID',
    description:
      'Removes an item by its ID. Returns the deleted resource for confirmation. Returns 404 if the item is not found.',
    request: {
      params: IdParams,
    },
    responses: {
      200: {
        description: 'Successful Response',
        content: {
          'application/json': {
            schema: ItemResponseSchema,
          },
        },
      },
      404: {
        description: 'No item exists with the provided identifier.',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  });
}
