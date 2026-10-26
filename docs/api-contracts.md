# API contracts

[Documentation index](../README.md#documentation)

## Items

The resource is `/api/v1/items`. There is currently no authentication or authorization middleware. Request bodies use JSON.

| Method and route                | Behavior                                                                    |
| ------------------------------- | --------------------------------------------------------------------------- |
| `POST /api/v1/items`            | Validate a create payload and return the created item with 201              |
| `GET /api/v1/items`             | Return paginated items with `data`, `total`, `page`, and `limit`            |
| `GET /api/v1/items/:id`         | Return one item or 404                                                      |
| `PATCH /api/v1/items/:id`       | Update supplied fields using required `expected_version`                    |
| `PUT /api/v1/items/:id`         | Replace using required `expected_version`; omitted description becomes null |
| `POST /api/v1/items/:id/delete` | Delete using required `expected_version`; return the removed DTO with 200   |

The [item schemas](../src/api/v1/items/models) define field validation and response mapping. The [controllers](../src/api/v1/items/controllers/items.controller.ts) validate request locations before calling the [item service](../src/api/v1/items/services/items.service.ts), which coordinates repository operations. Shared HTTP adapters own response mapping and serialization. PUT and PATCH require an existing identifier; neither creates a missing item. Optimistic concurrency is required for item mutations; there is no idempotency-key/replay contract.

## Item revisions and mutation preconditions

Every item response, including list entries, includes numeric `version`. Creation
starts at 1. Send the version from the last read as `expected_version` in the JSON
body of PUT, PATCH, or `POST /api/v1/items/:id/delete`:

```json
{ "price": 29, "expected_version": 1 }
```

```http
POST /api/v1/items/A1b2C3d4E5f6G7h8/delete
Content-Type: application/json

{ "expected_version": 2 }
```

- Versions/preconditions are integers from 1 through 4294967295. JSON strings,
  fractions, booleans, null, and missing values are invalid and return 422.
- PATCH must supply at least one editable field in addition to the precondition.
  PUT requires name and price; omission of description still clears it to null.
- Every accepted PUT/PATCH advances the revision exactly once, including updates
  whose submitted values equal stored values. Clients must retain the returned
  revision for the next mutation. Overflow returns 409 without changing data.
- A valid request for a missing/deleted item returns 404. An existing item with a
  stale precondition returns 409 without mutation. Reload before reconciling a
  stale edit; do not silently replace its precondition and overwrite newer data.
- Deletion returns the removed item with its last persisted version; it does not
  increment a revision on a row that no longer exists. A later deletion returns 404.
- Lookup, SQL revision condition, write, response preparation, and final commit
  share the mutation transaction. A rollback also restores the previous revision.

This intentionally changes the client contract. The old `DELETE /items/:id` route
is removed (404); use the POST deletion action with a JSON body. Existing PUT/PATCH
requests without `expected_version` now return 422. No ETag/If-Match convention is
introduced. Versions prevent stale writes, not duplicate creation or uncertain
commit outcomes. POST creation still has no durable replay protection.

## Price precision and input

Prices use the existing MySQL `DECIMAL(10,2)` column and range from **0.01 through
99999999.99**. API inputs accept JSON numbers and unsigned plain decimal strings
such as `12`, `12.5`, and `"12.50"`. They must have at most two decimal places;
excess precision is rejected with 422 before persistence, never silently rounded.
The shared price contract also validates returned values and decimal filters.
Responses remain JSON numbers, so trailing zeros are not formatting guarantees.

Strings must contain digits with an optional decimal point and one or two following
digits. Blank/whitespace strings, surrounding whitespace, exponent/hex strings,
leading plus signs, booleans, arrays, objects, and null are rejected. `"1.230"` is
rejected for excess textual precision. JSON numbers are checked by their parsed
numeric value; JSON parsing does not retain their original spelling or trailing
zeros. No binary multiplication/modulo equality check or rounding is used to
accept values. Rejected create/update inputs leave rows and revisions unchanged.

## Pagination and filters

`page` defaults to 1; `limit` defaults to 25 and accepts positive integers up to 100.
The page must be a positive safe integer, and `(page - 1) * limit` must also be a
safe integer. Unsafe pages/offsets return 422; there is no additional arbitrary page
cap. These are arithmetic safety limits, not a guarantee that deep pagination is
cheap.

`search` matches item name or description. `sort` accepts `name`, `price`, or
`createdAt`; the default is `price`. `order` accepts `ASC` or `DESC`
case-insensitively and defaults to ascending. ID is always the unique secondary
sort in the same direction: default ordering is `price ASC, id ASC`.

Optional `min_price` and `max_price` are inclusive bounds using the same positive,
two-decimal price contract. Omit unused bounds; empty, malformed, repeated, or
crossed bounds return 422. The minimum cannot exceed the maximum.

This makes adjacent pages deterministic when the underlying data is unchanged.
Offset pagination is not a shared snapshot across requests: concurrent insertion,
deletion, or changes to sort values can shift rows and cause repeats/skips. The
item revision contract does not freeze list results. Cursor/snapshot pagination
is outside this change.

No schema migration is required for these price/query changes. This intentionally
narrows formerly broad coercion and excess-precision inputs; review clients that
relied on those behaviors. Existing valid two-decimal prices and response types
remain compatible.

## Response deadlines

The API response deadline defaults to 10 seconds, including body parsing. Expiry
returns the JSON error envelope with status 408 if no headers were sent; otherwise
the incomplete response is closed. Late controller responses are suppressed.
Server receive deadlines can return a raw 408 before Express handles the request.

Item mutations run in an explicit transaction that also covers response DTO
validation, status selection, and JSON preparation. Those failures roll back the
mutation; a success response is sent only after commit succeeds. Request expiry/disconnect observed
before the shared pre-commit check causes rollback after outstanding work settles.
It does not cancel running SQL. Expiry/disconnect racing the final check or an
already-started COMMIT cannot guarantee rollback; a lost response can mean the
write succeeded. Item operations
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
