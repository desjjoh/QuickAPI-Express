# Persistence failures and migration history

[Documentation index](../README.md#documentation)

## What the tests establish

Integration tests use guarded disposable MySQL. The item fault suite runs the real
HTTP middleware, controllers, item service, DTOs, TypeORM repository, and bounded pool. A
test-only TCP proxy frames MySQL COM_QUERY packets and can withhold a selected
query or its response. An independent connection bypasses the proxy to inspect
committed rows and server-side connection cleanup. This transport fixture uses
unencrypted MySQL; [TLS verification](database-settings.md) has separate evidence.

| Controlled failure                                                  | Expected evidence                                                                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database offline before item create/read/list/update/delete         | The request fails, existing rows remain unchanged, readiness becomes unavailable, and liveness remains responsive. The same application/pool recovers and the operation succeeds afterward. |
| Connection dropped before INSERT/UPDATE/DELETE reaches MySQL        | No item mutation persists; the failed connection disappears and the single-slot pool serves further work.                                                                                   |
| COMMIT forwarded, acknowledgement withheld, then connection dropped | Independent reads establish that the mutation committed before the client receives an error. Persisted rows remain committed; the application does not automatically replay the mutation.   |
| Lookup result withheld beyond the HTTP response deadline            | PUT/PATCH/deletion return 408; the workflow finishes inside its transaction, then rolls back before commit, preserving existing data.                                                       |
| Mutation result withheld beyond a deadline or client disconnect     | Creation/PUT/PATCH/deletion keep the transaction leased until SQL settles, then roll back; independent reads show unchanged rows and the pool remains usable.                               |
| Repeated failed writes                                              | Server-side failed connections disappear and a one-slot pool repeatedly accepts queued checks and a later successful write.                                                                 |
| SQL already running when HTTP expires                               | Existing database-drain tests establish that accepted SQL can finish after a 408 and remains tracked during shutdown.                                                                       |

`response-transaction.test.ts` additionally verifies rollback of create, update,
replace, and delete when response DTO validation or JSON serialization fails after
the service returns. Multiple service calls through separate repository instances
share one manager and one outer transaction: both writes commit together or both
roll back. A later service failure also rolls back earlier writes. Independent
reads verify persisted outcomes and a subsequent write verifies pool usability.
The suite compares standard transactional JSON preparation with Express's default
response serialization. Commit ordering/failure unit tests prove
that the handler never sends success while commit is pending or after it fails.

Raw MySQL transport failures currently return the generic **500 Internal Server
Error** response. Explicit pool admission/capacity/deadline failures have a
separate **503 Database temporarily unavailable** contract. Readiness returns
503 during dependency failure. These tests characterize those existing contracts;
they do not introduce new error mapping or automatic retries.

An HTTP error, timeout, or disconnect is not proof of database rollback. In
particular, a lost COMMIT acknowledgement can leave a successful write whose
outcome the caller does not know. Our controlled tests can inspect that outcome
independently; a caller cannot infer it from the error response. Do not blindly
retry a mutation under the assumption that it never ran. Durable idempotency and
replay remain planned; revision preconditions now protect stale updates/deletions.

Connection cleanup assertions inspect MySQL's process list, not only mocked
release calls. They verify disappeared failed connections and renewed use of a
single-slot pool. They do not claim that arbitrary running SQL has a universal
deadline or that a response timeout cancels a leased database operation.

## Item revision evidence

`item-revisions.test.ts` exercises the real HTTP/service/repository stack against
MySQL: versioned reads, accepted no-op updates, missing/stale/invalid preconditions,
retired DELETE routing, concurrent edit/edit, edit/delete, and delete/delete
requests, SQL conditions for direct repository writers, and overflow. Race tests
use a lookup barrier so both request transactions arrive before either proceeds;
the database handles the actual locking and writes. Existing response-preparation
and transport-fault tests include revision state in their rollback snapshots.

`item-revision-migration.test.ts` starts from the previous schema with existing
rows, null/non-null descriptions, boundary prices, and microsecond timestamps.
It verifies backfill to revision 1, data/timestamp/index preservation, no pending
schema diff, startup refusal before migration, and offline down/re-up behavior.
The down operation drops revisions; re-up starts them at 1 again. This is evidence
of schema mechanics, not authorization for online application rollback. See the
[rollout requirements](deployment.md#item-revision-rollout-and-rollback).

## Shared migrations and branch changes

Applied/shared migrations are immutable history. Add new migration files for new
schema changes; do not regenerate or rename an existing baseline after it has
been applied elsewhere. Switching Git branches changes source files, not the
schema or MySQL migration records. Stop the watch server before switching between
branches with different migration histories. Separate disposable schemas are
often easier for branches that intentionally have incompatible schemas.

The existing baseline creates `items`. If MySQL records the earlier
`SchemaUpdate1785694410039` name while the source expects
`SchemaUpdate1792778193584`, TypeORM sees an unapplied migration even when `items`
already exists. Application startup refuses readiness and cleans up its pool.
Explicitly running migrations attempts CREATE TABLE and fails with
`ER_TABLE_EXISTS_ERROR`; that failure is not a successful application or a repair
of migration history.

The migration-history tests reproduce this mismatch, preserve representative item
values/timestamps and table definition, and verify unchanged history after
startup/migration failure. They also exercise a **fixture-only** reconciliation:
prove no schema difference and exactly one expected pending baseline, explicitly
fake that baseline, retain the old history record and rows, and verify startup.
No application startup path performs this reconciliation.

## Verified history reconciliation

For an existing database whose history differs from the checked-out branch:

1. Stop the API/watch server, confirm the exact target host/schema, and take a
   recoverable backup or snapshot. Inspect the branch's migration files and the
   existing migration records. Do not reset a shared or valuable database.
2. Inspect `SHOW CREATE TABLE items` and compare every effect of the pending
   migration: columns, types, defaults, indexes, constraints, and any data changes.
   Run `npm run migration:validate` to check entity/schema drift as additional
   evidence. A no-drift result alone does not prove a historical data backfill ran.
3. Inspect pending migrations. If the only pending migration is the replacement
   baseline and **all** its effects already exist, explicitly review and approve
   recording that fact. If any effect is absent or any other migration is pending,
   stop and plan the actual upgrade/reconciliation instead.
4. Only after that verification, `npm run migration:run -- --fake` records pending
   migrations without executing SQL. In PowerShell use
   `npm.cmd run migration:run -- --fake` so options reach TypeORM. Fake application
   applies to the pending set, so checking its exact membership is essential.
5. Recheck migration history, schema drift, preserved data, and API readiness.
   Retain the verification and backup reference with the deployment/change record.

Read-only inspection commands (they use the selected application environment):

```bash
npm run typeorm -- migration:show -d src/config/database.config.ts
npm run migration:validate
```

```sql
SELECT id, timestamp, name FROM migrations ORDER BY id;
SHOW CREATE TABLE items;
```

Use `npm.cmd` for option-forwarding commands in PowerShell. The fixture's success
does not authorize fake application to another database or establish that its
schema/data matches. Do not manually delete history records to make a migration
appear unapplied; that can rerun destructive or incompatible SQL.

## Rollback and future upgrade evidence

The initial migration's `down()` drops `items`. It is destructive teardown, not a
data-preserving production rollback. Rolling back an image does not undo schema
changes. Confirm that the previous application supports the current schema before
redeploying its [verified digest](releases.md#promotion-and-rollback). Prefer a
compatible forward repair; any required restore needs a separately rehearsed
backup/recovery procedure.

These history fixtures establish handling of an already-existing baseline; they
do not establish a future upgrade/backfill's safety. With each future migration,
start from its actual predecessor containing representative rows and test data
preservation, backfills, defaults, indexes, deployment ordering, and supported
application-version compatibility. Add concurrency, replay, and cross-write
rollback tests alongside the item mutation contracts that require them.

## Running the evidence

```bash
npm run test:integration -- test/integration/item-database-faults.test.ts test/integration/migration-history.test.ts
```

The normal integration suite includes both files. The wrapper validates test
database safety before starting disposable infrastructure, applies committed
migrations explicitly, runs the selected tests once, and tears down its container
and volumes while preserving failures. See [Testing](../test/TESTING.md) for
PowerShell, existing local test MySQL, and environment-selection instructions.

These tests do not establish real deployment DNS/TLS rotation, HA failover,
backup restoration, or orchestrator behavior. They also do not make current item
writes idempotent or protect concurrent clients from stale writes.
