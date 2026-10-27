import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { apiPath } from '@/common/helpers/path.helpers';
import { ErrorResponseSchema } from '@/common/library/models/exception.model';
import { IdParams } from '@/common/library/models/parameters.model';

import { CreateItemSchema } from '../models/item-create.model';
import { ReplaceItemSchema } from '../models/item-replace.model';
import { VersionInputSchema } from '@/common/library/models/version.model';
import { UpdateItemSchema } from '../models/item-update.model';
import {
  ItemListResponseSchema,
  ItemResponseSchema,
} from '../models/item.model';
import { ItemPaginationQuerySchema } from '../models/pagination-query.model';
import { IdempotencyKeySchema } from '@/common/library/models/idempotency.model';

export function registerItemPaths(registry: OpenAPIRegistry): void {
  const tag = 'Items';

  // GET /items
  registry.registerPath({
    method: 'get',
    path: apiPath('/items'),
    tags: [tag],
    summary: 'Get a list of items',
    description:
      'Retrieves a paginated list of items. Sort ties use ID in the same direction; defaults to price ASC, ID ASC. Price bounds are inclusive and accept up to two decimal places. Offset pagination is not a snapshot across requests.',
    request: {
      query: ItemPaginationQuerySchema,
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
      'Creates a new item using validated input. Optional Idempotency-Key replays the original successful status and JSON for 24 hours from database completion time. The scope is public for this operation: callers sharing a key share replay/conflict behavior; keys are not authorization. Fingerprints use normalized validated input. Busy keys and changed input return 409. Replays do not extend retention or create another item. Without a key, retries can create duplicates. Expired keys may execute again. Failed attempts are not cached; a response deadline cannot cancel SQL or undo an already-started commit.',
    request: {
      headers: [
        IdempotencyKeySchema.optional().openapi({
          param: { name: 'Idempotency-Key', in: 'header' },
          description:
            'One case-sensitive opaque key, 1–128 printable ASCII characters without whitespace or commas. Duplicate fields are rejected. Retain the same key for retries.',
          pattern: '^[\\x21-\\x2b\\x2d-\\x7e]+$',
          example: '0ba3eb40-c95d-46fd-a9ad-79c079708d28',
        }),
      ],
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
      ...Object.fromEntries(
        [
          [400, 'Invalid or duplicate Idempotency-Key header.'],
          [
            409,
            'Key still processing or previously used with different input.',
          ],
          [422, 'Invalid item input; no replay claim or item write.'],
          [
            408,
            'Request deadline exceeded; a commit already in progress may still succeed.',
          ],
          [
            500,
            'Execution or replay coordination failed; retry the same key to reconcile an uncertain commit.',
          ],
          [503, 'Database admission/capacity unavailable.'],
        ].map(([code, description]) => [
          code,
          {
            description: String(description),
            content: { 'application/json': { schema: ErrorResponseSchema } },
          },
        ]),
      ),
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
      'Applies a partial update to an existing item. Requires expected_version. Only provided fields are modified. Every accepted update advances version once, including no-op edits.',
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
      409: {
        description: 'Stale item version; reload before retrying.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      422: {
        description: 'Invalid input or missing expected_version.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
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
      'Replaces an existing item with the provided data. Requires expected_version, name, and price; omitted description becomes null. Every accepted replacement advances version once.',
    request: {
      params: IdParams,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: ReplaceItemSchema,
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
      409: {
        description: 'Stale item version; reload before retrying.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      422: {
        description: 'Invalid input or missing expected_version.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
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

  // POST /items/{id}/delete
  registry.registerPath({
    method: 'post',
    path: apiPath('/items/{id}/delete'),
    tags: [tag],
    summary: 'Delete an item by ID',
    description:
      'Requires expected_version in the JSON body. Returns the removed item and its final version; stale versions return 409 and missing items return 404.',
    request: {
      params: IdParams,
      body: {
        required: true,
        content: { 'application/json': { schema: VersionInputSchema } },
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
      409: {
        description: 'Stale item version; reload before retrying.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      422: {
        description: 'Invalid input or missing expected_version.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
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
