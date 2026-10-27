# Request idempotency and atomic replay

[Documentation index](../README.md#documentation)

## Status and scope

Pass 1 defined the implementation contract on 2026-10-26. Pass 2 implements shared
schemas, canonical fingerprints, validated policy, and replay storage/migration.
Pass 3 adds shared lock/claim/replay execution and transaction/resource ownership.
Pass 4 enables optional keyed creation through the HTTP handler, with header
validation, CORS and OpenAPI integration. Pass 5 supplies lifecycle-owned bounded
cleanup, process/recovery tests, and keyed production-image smoke. All five passes
are implemented. The evidence below establishes specific tested outcomes; it does
not promise cancellation of running SQL, exactly-once delivery, or protection beyond
retention.

All item mutations accept an optional key. Each has an explicit stable method/route
and separate operation identifier:

| Method and route                | Operation       |
| ------------------------------- | --------------- |
| POST `/api/v1/items`            | `items.create`  |
| PATCH `/api/v1/items/:id`       | `items.update`  |
| PUT `/api/v1/items/:id`         | `items.replace` |
| POST `/api/v1/items/:id/delete` | `items.delete`  |

No-key behavior is unchanged. Updates/deletion still require `expected_version`.
Reads and system endpoints ignore this header. No authentication, Redis dependency,
uploads or external-provider coordination is introduced by this work.

The shared implementation follows Nest's separation of endpoint opt-in, HTTP
integration, central idempotency service, fingerprinting, and MySQL persistence.
Express intentionally adapts authenticated scope to an explicit public scope,
fingerprints validated input, and stores its already-prepared JSON string. Expiry
is assigned when completing the response record rather than creating the
claim. Cleanup uses bounded batches rather than an unbounded delete.

## Key and scope contract

- Accept exactly one `Idempotency-Key` header containing 1–128 printable ASCII
  characters, excluding whitespace and commas. Empty/invalid keys, duplicate
  header fields, arrays, and combined header values return 400 before database
  work. Do not trim, case-fold, or otherwise change an accepted key.
- Clients generate unpredictable keys, such as UUIDv4 values, before the first
  attempt and retain the same key for retries of that operation.
- Scope combines an application/database namespace, explicit caller namespace,
  stable operation identifier, canonical method/route, and key. Hash this tuple
  for storage and MySQL lock identity; do not log or retain the raw key.
- Item mutations explicitly use caller namespace `public`. There is no per-user
  namespace: two callers using the same key for this operation share its conflict
  and replay behavior. A key is not authentication or authorization. Do not infer
  identity from IP, forwarded headers, cookies, or request IDs.
- Future authenticated domains must supply a trusted actor/tenant scope through
  shared infrastructure; they must not silently reuse the public namespace.
- Header sanitization and browser CORS configuration must admit the key on the
  supported operation. Existing validation, admission, and rate limiting still
  apply to retries; the header does not bypass them.

### Configuring another scope

The current HTTP option accepts a fixed string per endpoint. For example:

```ts
idempotency: {
  operation: 'items.update',
  scope: 'inventory-import',
  route: 'PATCH /api/v1/items/:id',
}
```

This is an illustrative alternative, not the current item configuration. With all
other scope components unchanged, `public` and `inventory-import` treat the same key
as independent requests. A scope name supplies no authentication or access control.
Changing an existing endpoint's scope prevents its previous records from matching;
plan compatibility for unexpired keys before doing so, because creation or other
side effects may execute again when domain preconditions allow.

Dynamic per-user or per-tenant scopes are not supported by the current controller
option. A future implementation should resolve trusted identity centrally in the
HTTP infrastructure, after authentication and authorization, before lock acquisition
and replay lookup. Controllers would declare the scope policy; business services
would remain unchanged. Do not use an arbitrary body/query/header value as trusted
caller identity. Any authenticated replay must still pass current authorization.
This describes a future extension, not an authentication feature or implementation
commitment for the current public item service.

## Fingerprint contract

Hash a canonical JSON representation of the validated values relevant to the
operation: body, route parameters, and semantic query values when applicable.
Object keys are sorted recursively; array order and string content remain
significant. Exclude transport noise such as request IDs, host, forwarding headers,
connection details, and JSON whitespace. Ignored/stripped unknown input fields do
not change the fingerprint.

For item creation, price normalization means `"12.50"` and `12.5` fingerprint the
same. Property ordering does not matter. Omitted optional description and explicit
null remain distinct validated inputs; no additional domain normalization is
inferred. Changing a meaningful field under the same unexpired key returns 409.
Changing normalization/fingerprint rules later needs a compatibility plan for
unexpired records; deployment must not casually invalidate existing replay keys.

## Request and outcome examples

```http
POST /api/v1/items
Content-Type: application/json
Idempotency-Key: 0ba3eb40-c95d-46fd-a9ad-79c079708d28

{"name":"Travel Pack","price":"12.50"}
```

The first successful response is 201 with the validated item, including its ID,
revision 1, and timestamps. An identical retry within retention returns that
original status and prepared JSON without invoking the service again. It does not
return the item's latest state. Updates or deletion after creation do not change
the retained creation response or cause replay to recreate the item.

| Condition                                                                                             | Outcome                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| No key                                                                                                | Existing non-replay creation behavior                                                                |
| Invalid/duplicate key header                                                                          | 400; no claim or item write                                                                          |
| Invalid request payload                                                                               | Existing 422 validation response; no claim or item write                                             |
| Same scope/key still executing                                                                        | Immediate 409; retry the same key later; no duplicate execution                                      |
| Completed, unexpired record with matching fingerprint                                                 | Original status and JSON replay; no item write or revision increment                                 |
| Completed, unexpired record with a different fingerprint                                              | 409; preserve original item and replay record                                                        |
| Expired record, even if physically present                                                            | Eligible for a new execution after acquiring the key lock                                            |
| Business failure, DTO/serialization failure, replay-write failure, or response over the storage limit | Roll back all participating writes; no completed replay result; preserve existing error mapping      |
| Generic database/coordination failure                                                                 | Fail closed with existing 5xx handling; never silently execute without replay protection             |
| Pool admission/capacity failure                                                                       | Existing 503 response; no success or unprotected fallback                                            |
| Timeout/disconnect observed before commit                                                             | Keep tracking work until it settles, then roll back; suppress late response writes                   |
| Commit succeeds but response/commit acknowledgement is lost                                           | Persist both item and completed replay record; a later matching retry replays the committed response |

Successful 2xx outcomes are stored. Error responses are not cached as successful
replays; participating writes must roll back on unsuccessful execution. A failed
attempt can execute again with the same key after its transaction and lock settle.
Fresh request/correlation headers are generated for retries; only the original
status and JSON body are replayed, not cookies or transport/request-specific headers.

## Shared execution and atomicity

The HTTP handler delegates keyed execution to the common idempotency service before
opening an application transaction. The service pins one query runner/connection,
acquires a non-waiting MySQL lock for the scope hash, and owns the outer transaction.

1. Validate the request and key; compute scope and fingerprint.
2. Acquire the scope/key lock on the pinned connection. Contention returns 409;
   a database error/null lock result is a coordination failure, not proof of an
   overlapping request.
3. Begin the transaction and inspect the replay record using the same manager.
4. Replay a valid completed record, or replace an expired record and insert a claim.
5. Invoke the service, map/validate its DTO, select the response status, and prepare
   JSON once using the existing `JSON.stringify()` response path.
6. Store that exact response string/status and expiry in the completed record.
7. Check the request deadline and commit the item and completed record together.
8. Release the lock and connection, then send the prepared response if possible.

Service transaction wrappers join the outer transaction through the existing
helper. Every participating repository must use its supplied manager. Multiple
service/repository calls commit together; an independent transaction, another
database, or an external side effect is outside this guarantee. The item service
gets no key-handling, replay, response, or request-lifecycle code.

A processing claim is inserted inside the same transaction, not committed separately
before the item. The MySQL lock fences concurrent requests while that claim is
uncommitted. Loss of the database connection before commit rolls back unfinished
work; a client disconnect follows the existing drain/pre-commit deadline checks.
Neither may leave a separately committed processing claim permanently blocking
retries. Commit uncertainty still follows the outcome table above. Completed
records survive API restarts. API instances must coordinate against the same MySQL
writer; server-local advisory locks are not a multi-writer database protocol.

Never release a connection or attempt rollback while its accepted SQL is still
running. If lock release fails, discard the connection rather than returning a
possibly locked session to the pool. Database uncertainty must not be interpreted
as permission to retry the item write inside the same attempt.

### Shared execution and HTTP boundary

`src/common/services/idempotency.service.ts` accepts an explicit scope, key,
fingerprint, and asynchronous callback that returns a prepared successful response.
It must be called before entering an application transaction. HTTP infrastructure
supplies response preparation after request validation; conceptually:

```ts
const prepared = await idempotency.execute(
  scope,
  key,
  requestFingerprint({ body: validatedBody }),
  async () => {
    const item = await itemService.create({ body: validatedBody });
    return { status: 201, json: JSON.stringify(toItemDTO(item)) };
  },
);
```

The controller declares only endpoint policy:

```ts
jsonHandler(itemService.create, toItemDTO, {
  status: 201,
  transaction: true,
  idempotency: {
    operation: 'items.create',
    scope: 'public',
    route: 'POST /api/v1/items',
  },
});
```

`jsonHandler` requires transaction opt-in, validates one key (counting original raw
header fields), fingerprints `req.validated`, and delegates keyed execution before
opening any transaction. The callback invokes the existing service, validates the
DTO, resolves status, and stringifies once before completion/commit. A replay skips
all three preparation steps. Bodyless 204/205 outcomes store no JSON. The handler
sends only after execution and session cleanup finish, and suppresses late writes.
The no-key path retains its previous handler transaction and response behavior.

The controller option is named `scope`; HTTP infrastructure maps it to the existing
internal `callerScope` field and persisted `caller_scope` column. No migration or
creation-hash change accompanies this rename. Keep `route` explicit: use a stable
method plus route template, never a concrete item ID or raw query string. This avoids
relying on router nesting or mount-path discovery. The validated item ID, semantic
query values, and body belong to the fingerprint. Reusing a key for a different ID
under the same operation returns 409; keys are independent across operations.

For updates/deletion, replay precedes service execution and current-version/item
lookup. Keep the original `expected_version` in a retry. A completed retry returns
its original 200/DTO without incrementing again or failing because the version
advanced or the item was deleted. Changing that version or payload under the same
key returns 409. Missing `expected_version` still fails request validation (422),
even on a retry. A new key or no key performs a new operation and enforces current
version/existence, returning 409 or 404 as appropriate. Error responses are not
cached. After expiry the original version can be stale or the item missing; expiry
does not reset domain preconditions.

The shared namespace hashes `[APP_NAME, DB_DATABASE]`; host aliases and app versions
do not change it. Keep those values and operation/scope/route identifiers stable
across replicas and releases. Changing them creates a new replay namespace and can
allow repeated execution of a previously used key.

Sanitization always preserves `Idempotency-Key`. Default browser CORS allows it;
custom `CORS_ALLOWED_HEADERS` must include it for browser preflight to succeed.
Omitting it from CORS does not disable server-side enforcement. Node parses normal
HTTP header whitespace before application code; the application performs no key
trimming or case conversion. Unsupported endpoints ignore this header. Validation,
origin policy, rate limiting, and request deadlines still apply to retries.

Services keep their existing transaction wrappers; those wrappers join the pinned
outer manager through AsyncLocalStorage. Supplying a manager remains mandatory for
each participating repository operation. Nesting another idempotency execution is
rejected before acquiring another connection.

Only a definite `GET_LOCK` result of zero is a busy-key 409. NULL, malformed results,
and SQL errors fail closed and discard the uncertain session. Completion and commit
finish before lock release and connection release. An active transaction left after
failed rollback also causes session destruction. No request timeout races cleanup
against pending work, including an accepted SQL statement.

Unexpired replay validates the stored response but applies the fixed hard ceiling,
so lowering the configured size limit does not invalidate already-accepted results.
Unexpected processing state or corrupt response data fails closed without invoking
the callback. Expired replacement and its new result are in one transaction: if
replacement fails, the prior expired row is restored by rollback.

A lock/connection-release failure after commit is reported as a failure even though
the mutation and response record may already be committed. A later matching retry
replays that record. Cleanup errors do not replace an earlier business/database
error. These rules preserve uncertainty rather than claiming every failed attempt
rolled back. Advisory locks coordinate connections to the same MySQL server; they
do not coordinate independent database writers.

## Retention and bounded storage

Retention is **24 hours**, stored per completed record using the shared database
clock. Set `expires_at` from the completion timestamp written with the prepared
response immediately before commit. The window is measured from that timestamp,
not HTTP delivery; time spent completing commit does not restart the window.
Nest currently assigns expiry at claim creation; this intentionally avoids charging
Express's service execution time against its replay retention.

- A record is eligible for replay when database time is strictly before expiry.
  At equality it is expired. Determine eligibility while coordinating that key.
- Replays never extend expiry. Restarting an API or adding instances does not
  reset it. Active key ownership is controlled by the lock, not a 24-hour timer.
- Expired keys may execute again, even if the old item still exists. Clients must
  reconcile uncertain outcomes after retention rather than assume indefinite
  duplicate protection.
- Logical expiry is independent of physical deletion. An undeleted expired record
  must not replay; its replacement is coordinated under the same key lock.
- Run a lifecycle-owned cleanup sweep hourly. Use bounded batches, prevent
  overlapping sweeps, recheck expiry in deletion conditions, and remove only
  expired completed records. Stop scheduling on shutdown and track in-flight
  cleanup before database teardown. Cleanup must not invalidate unexpired replays.
- Cleanup failure is logged safely and retried later; it does not change expiry,
  unlock active work, or permit unprotected execution. Delayed deletion does not
  promise an exact physical-retention upper bound.

Confirmed shared defaults are **64 KiB of UTF-8 prepared JSON per response**,
**100 records per cleanup batch**, and **at most 10 batches per hourly sweep**.
The response limit may be reduced but cannot exceed 65536 bytes. Batch size must be
1–1000, batch count 1–100, and their product at most 10000. Empty, fractional,
non-finite, and out-of-range configuration fails validation. Retention remains fixed
at 24 hours; the sweep interval is fixed at one hour. Optional settings are
listed in the structured environment files and [development guide](development.md).
Defaults allow at most 1000 rows per process per sweep; multiple API replicas each
run their own timer. No distributed scheduler or leader election is needed for
these conditional deletes.

### Cleanup lifecycle

`src/common/services/idempotency-cleanup.service.ts` owns the timer. The application
registers database → cleanup → HTTP services in `src/application.ts`:

1. Database initialization and migration verification succeed before cleanup starts.
   Cleanup starts one unreferenced hourly timer; there is no immediate startup sweep.
   If later HTTP startup fails, reverse startup cleanup stops that timer.
2. An hourly tick skips an already-active sweep. Each sweep awaits one batch at a
   time, stops on a short batch, and never exceeds the configured batch count.
   Direct internal sweep calls share the in-flight promise. There is no public HTTP
   cleanup endpoint and no additional timer configuration.
3. `IdempotencyRepository.purgeExpiredBatch()` issues one autocommit DELETE ordered
   by expiry/key and limited to the validated batch size. Its predicate requires
   completed state and `expires_at <= UTC_TIMESTAMP(3)`. MySQL rechecks that predicate
   after waiting on row locks, so an expired-key replacement that becomes unexpired
   cannot then be deleted by a waiting sweep. Processing claims and item rows are
   never cleanup targets. Failed statements do not disable replay protection.
4. Timer failures are logged safely; the next hourly tick can retry. The sweep's
   in-flight state is cleared on success or failure. Pool acquisition retains the
   existing capacity/acquisition limits. Row-count bounds are not a SQL execution
   deadline: a delete may wait for a database lock, and running SQL is not cancelled.
5. Shutdown quiesces scheduling immediately. Reverse service shutdown drains HTTP,
   then awaits the accepted cleanup batch, skips subsequent batches, and closes
   MySQL afterward. An active cleanup failure propagates to lifecycle shutdown.
   The existing overall shutdown watchdog forces a failing finite exit for stuck
   cleanup; it does not close MySQL early and claim the SQL was cancelled.

Logical expiry remains independent of the scheduler. Delayed or failed deletion
does not extend replay eligibility, and unused expired rows can remain beyond
24 hours. Expiry/replacement happens under the request key lock even between sweeps.
Cleanup requires no additional migration; the expiry index shipped in pass 2.

The repository requires an active transaction manager for writes and stores the
prepared JSON string unchanged in MEDIUMTEXT, which accommodates the full 65536-byte
boundary. Successful completion sets both timestamps using MySQL UTC time; only a
processing record can be completed. Expiry reads and conditional deletion also use
database time. A 204/205 result has no JSON body; other successful statuses require
valid JSON. Oversized or invalid responses reject completion rather than truncate.
The execution service connects these primitives to the shared transaction and the
HTTP adapter prepares the original response inside that boundary.

Canonicalization accepts validated plain JSON values, omits undefined object fields,
and rejects cycles, sparse/undefined array entries, non-finite numbers, and class
instances. Domains using dates or richer values must normalize them before hashing.
TTL, response size, and bounded cleanup do not establish an absolute table-size cap;
storage depends on throughput and cleanup backlog. Database/storage failures must
fail closed.

## Reusable components and implementation passes

| Component                                     | Ownership                                             |
| --------------------------------------------- | ----------------------------------------------------- |
| Key/scope/prepared-response contracts         | Common library; no item-specific dependencies         |
| Canonicalization and hashing                  | Common helpers accepting validated values             |
| Lock, claim, replay, transaction coordination | Common idempotency service                            |
| Replay entity/repository and expiry index     | Database layer shared across domains                  |
| Retention, size and cleanup policy            | Central validated configuration                       |
| Header/CORS/OpenAPI and handler opt-in        | HTTP infrastructure and endpoint configuration        |
| Item business mutations                       | Existing item service/repository, with shared manager |

The five implementation passes are complete. Preserve these contracts and add
equivalent failure evidence before extending opt-in to another operation.

## Required failure evidence

Each pass adds focused evidence; enabling the endpoint is not the completion gate.

| Boundary          | Required assertions                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header/input      | Key length/characters/duplicate fields; invalid bodies before claims; header sanitization and browser preflight                                                                     |
| Fingerprint       | Key-order stability, normalized price equivalence, meaningful differences, omitted/null distinction, array order, no transport-noise influence                                      |
| Storage/migration | Populated predecessor upgrade, unchanged item data, unique scope/hash enforcement, expiry index, response byte bounds and offline rollback expectations                             |
| Concurrency       | Barriers for simultaneous duplicates/conflicts; separate processes sharing MySQL; exactly one item/result; no service execution on replay                                           |
| Failure/atomicity | Acquisition/lock errors, SQL/business failures, DTO/JSON failures, oversized results, replay insertion/finalization failures, and commit failure; no partial item/replay success    |
| Transport         | Timeout/disconnect during work or response preparation; no success before commit; a committed but undelivered result replays without another mutation                               |
| Recovery          | Restart persistence, lost commit acknowledgement, expired-key reuse, expiry equality, non-extending replay, cleanup/request races, cleanup failures and shutdown during active work |
| Resource cleanup  | No retained transaction/lock/connection after success or failure; a bounded/single-slot pool can serve later requests; no premature release during pending SQL                      |
| Replay fidelity   | Original JSON/status after later item update/deletion, dates/numeric prices, response size, and fresh per-attempt request IDs                                                       |
| Regression        | No-key behavior, existing revision/price contracts, fail-closed errors, full suites and actual production-image smoke                                                               |

Use unit tests for pure contracts and orchestration, real MySQL for persistence and
atomicity, and HTTP/process tests for transport/restart/multi-instance behavior.
Prefer barriers and controlled fault injection to sleep-based races. Inspect
persisted outcomes independently: at creation commit there is one matching item
and replay result; rolled-back creation has neither. Later item deletion does not
remove the retained replay result or make replay recreate the item. Do not claim running-SQL cancellation,
exactly-once network delivery, or duplicate protection beyond retention.

Implemented evidence includes bounded batches and independent sweepers, live and
processing-record preservation, a waiting delete racing expired-key replacement,
cleanup failure/retry, and a real pinned MySQL session disconnect with rollback and
recovery. Separate API processes exercise simultaneous duplicates/conflicts,
restart persistence, expired-key reuse, process termination before commit, and
draining accepted work. A controlled socket close after an actual commit proves
replay of a committed but undelivered response after restart. Shutdown tests await
active cleanup before database close and force exit for stuck cleanup. Unit timers
verify the hourly schedule and non-overlap without waiting an hour in tests.

Production smoke builds the actual image once, verifies exact prepared replay and
fresh correlation IDs, conflicts, replay after deletion, persistence after API
restart, and normal SIGTERM. Lost commit acknowledgement is fault-injected around
a real commit; actual MySQL writer failover and arbitrary network partitions remain
deployment-owned evidence, not guarantees inferred from these tests.
