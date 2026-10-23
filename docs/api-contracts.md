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

## Response deadlines

The API response deadline defaults to 10 seconds, including body parsing. Expiry
returns the JSON error envelope with status 408 if no headers were sent; otherwise
the incomplete response is closed. Late controller responses are suppressed.
Server receive deadlines can return a raw 408 before Express handles the request.

A timeout or disconnect does not cancel an already-running database mutation or
guarantee rollback. A lost response can mean the write succeeded. Item operations
still have no idempotency contract; reconcile uncertain results before retrying.
New requests reaching the shutdown admission guard receive 503 with connection
closure; once the listener closes, connections are refused instead.

## Errors and HTTP policies

Operational routes follow validated [exposure settings](development.md#operational-endpoint-exposure).
Documentation, metrics, and runtime diagnostics default to disabled in production
and enabled in development/test. Disabled routes return 404. Enabling a route does
not authenticate callers; restrict metrics and diagnostics at the ingress and
block direct public access to the API listener.

The rolling-window limiter returns 429 for an exhausted client quota and 503 when
an unseen client cannot be tracked because the store is full. Both include an
integer `Retry-After` in seconds and the standard JSON error body. See
[rate limiting](rate-limiting.md) for defaults, capacity policy, and retry timing.

`/ready` uses bounded database connectivity checks and returns
`{ ready, status, timestamp }` with 200 or 503. Dependency names and timings
are internal; the former `checks` response field has been removed in every
environment. `/health` does not query MySQL.
See [database readiness and recovery](database-lifecycle.md) for caching, outage
timing, migration checks, and connection cleanup. Business writes are not retried
automatically after a database disconnection.

Errors use `{ status, message, timestamp }`. Schema validation and malformed JSON return 400; missing items return 404. Unexpected failures return a generic 500 while internal details are logged. Body limits, content-type restrictions, header policies, and rate limiting apply before routes; see [middleware ordering](architecture.md#createapp-middleware-ordering).

Swagger at `/docs`, JSON at `/docs-json`, and ReDoc at `/redoc` expose the generated schemas. CORS defaults to `http://localhost:3000` and is configurable through the validated [HTTP policy settings](development.md#proxy-and-cors-configuration). See [backlog](backlog.md) for remaining runtime gaps.
