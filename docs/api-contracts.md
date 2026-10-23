# API contracts

[Documentation index](../README.md#documentation)

## Items

The resource is `/api/v1/items`. There is currently no authentication or authorization middleware. Request bodies use JSON.

| Method and route           | Behavior                                                          |
| -------------------------- | ----------------------------------------------------------------- |
| `POST /api/v1/items`       | Validate a create payload and return the created item with 201    |
| `GET /api/v1/items`        | Return paginated items with `data`, `total`, `page`, and `limit`  |
| `GET /api/v1/items/:id`    | Return one item or 404                                            |
| `PATCH /api/v1/items/:id`  | Update at least one supplied field or return 404                  |
| `PUT /api/v1/items/:id`    | Apply a complete create payload; omitted description becomes null |
| `DELETE /api/v1/items/:id` | Return the removed item's DTO with 200, or 404                    |

The [item schemas](../src/api/v1/items/models) define field validation and response mapping. The [controllers](../src/api/v1/items/controllers/items.controller.ts) validate request locations before calling the repository. PUT and PATCH require an existing identifier; neither creates a missing item. There is no optimistic concurrency or idempotency-key contract.

## Pagination and filters

`page` defaults to 1; `limit` defaults to 25 and accepts positive integers up to 100. `search` matches item name or description. `sort` accepts `name`, `price`, or `createdAt`; the repository defaults to `price`. `order` accepts `ASC` or `DESC` case-insensitively and defaults to ascending. Optional `min_price` and `max_price` are positive integers; the minimum cannot exceed the maximum.

## Errors and HTTP policies

Errors use `{ status, message, timestamp }`. Schema validation and malformed JSON return 400; missing items return 404. Unexpected failures return a generic 500 while internal details are logged. Body limits, content-type restrictions, header policies, and rate limiting apply before routes; see [middleware ordering](architecture.md#createapp-middleware-ordering).

Swagger at `/docs`, JSON at `/docs-json`, and ReDoc at `/redoc` expose the generated schemas. The current CORS origin is hardcoded to `http://localhost:3000`; deployment origins require a configuration/code change. See [backlog](backlog.md) for known runtime gaps.
