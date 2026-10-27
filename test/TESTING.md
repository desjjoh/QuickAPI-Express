# Testing

[Documentation index](../README.md#documentation)

## Tests and database safety

Unit tests need no container. Integration and end-to-end wrappers validate the target,
start `docker-compose.test.yml`, wait for disposable MySQL, apply migrations, and
run the selected suite exactly once, and execute teardown from an `EXIT` trap
even when startup, preparation, or tests fail. Initial safety rejection happens
before installing teardown. The original failure status survives a cleanup
failure; cleanup failure also fails an otherwise successful run:

```bash
npm run test:unit
npm run test:security
npm run test:integration
npm run test:e2e
npm run test:migration
```

The disposable service binds only to `127.0.0.1:3318` and stores MySQL data in `tmpfs`. Destructive
infrastructure commands first require all of the following:

- `NODE_ENV` is exactly `test`;
- `DB_DATABASE` matches `^[a-z0-9_]+_disposable_test$` and is not a protected generic name; and
- `DB_HOST` is a recognized local/CI host, or is explicitly included in the comma-separated
  `TEST_DB_ALLOWED_HOSTS` allowlist.

The checked-in `.env.test` matches the disposable Compose service: host `127.0.0.1`,
port `3318`, database `quickapi_disposable_test`, user `quickapi_test_user`, and
password `quickapi_test_password`. Existing process environment values override
the file. The shared database test helper validates the target before connecting
or deleting item fixtures, including when Vitest runs directly.

`npm run test:infra:down` removes
containers, anonymous resources, orphans, and volumes. Do not point these commands at development,
staging, or production data.

## Continuous integration and deployment gate

`.github/workflows/ci.yml` is named `CI`, matching the other QuickAPI apps. It runs
for pull requests targeting `main`, `staging`, or `dev`, and for pushes to those
branches. Feature-branch pushes do not start an additional push run alongside the
PR run. Merge queue (`merge_group`), manual (`workflow_dispatch`), and reusable
(`workflow_call`) invocations are also supported. New runs cancel superseded runs
for the same workflow/ref; PR refs are separate from branch refs.

Validation uses Node 24.22.1 and locked installs:

1. dependency/image gate regression tests and real production dependency audit;
2. formatting and linting (`check:format-lint`);
3. type-check and production build (`check:type-build`);
4. unit tests with coverage and uploaded reports;
5. integration tests against a MySQL service after the safety check and migrations;
6. end-to-end tests with the same isolated preparation;
7. migration drift validation against its own disposable schema; and
8. digest validation, production image smoke, and an OS/Node vulnerability scan of
   that same immutable runtime image.

The required `Deployment gate` job retains its name and requires every validation
job to succeed. Naming the workflow changes the displayed prefix from its file
path to `CI`; it does not rename the required job. Existing run history retains
its original labels and event types.

`npm run test:security` runs the Node gate regressions independently of Vitest,
using synthetic reports and fake command runners. It covers critical-only
blocking, exact/expired/invalid exceptions, incomplete evidence, command failures,
and image/archive/config identity. It needs no Docker, database, or registry.
`npm run check` includes it. Real `security:audit` and `security:image` invocations
require network access; image scanning also requires Docker. Raw reports and
decisions are retained on CI failure. See [security lifecycle](../docs/security.md)
for development-only reporting, exception policies, commands, and release limits.

## Test categories and coverage

- `test/unit` covers isolated behavior; `npm run test:unit:coverage` runs the unit coverage gate.
- `test/integration` covers HTTP middleware and repository/API integration. Some files are database-independent; the complete project requires MySQL.
- `test/e2e` exercises the listening application with disposable MySQL.
- `test/helpers/database` owns infrastructure orchestration and target safety checks.

`npm run test:database:tls` is an additional Docker Compose check, run by CI's
integration job. It starts a separate disposable MySQL service on a dynamically
published loopback port, verifies encrypted connections and certificate rejection,
then tears down only its own project. It does not use or reset `.env.test`'s database.
The standard unit/integration/E2E commands do not invoke this extra Docker check,
so native-MySQL workflows remain supported. See [database settings](../docs/database-settings.md)
for pool, deadline, TLS evidence, and fixture details.

`npm run test` starts Vitest in watch mode. `test:integration:run` and `test:e2e:run` run their projects directly against already prepared infrastructure, as CI does. `test:coverage` runs all projects with coverage and likewise requires database preparation.

`test:migration` prepares disposable MySQL and invokes `test:migration:run` once;
there is no Vitest migration project. The direct command checks target safety and
loads `.env.test` before running TypeORM's no-drift check. In contrast,
`migration:validate` uses the application's `.env` for intentional development
schema validation. Do not substitute it for the disposable test command.

Wrapper options are forwarded with their argument boundaries intact, for example
`npm run test:integration -- test/integration/items-api.test.ts`. Shell-script
regressions in the unit suite require Bash (Git Bash on Windows); they use a fake
npm executable and never start containers or access a database.

For unit-only watch mode, use `npm test -- --project unit`. For database-backed
watch mode, first run `npm run test:infra:up` and `npm run test:infra:prepare`, then
start `npm test`. Stop watch mode before running `npm run test:infra:down`.
Vitest does not start MySQL or apply migrations automatically. A pending-migration
failure means the selected disposable database needs preparation; do not disable
the guard or run migrations against a generic `test` schema to bypass it.

Port `3318` keeps this repository separate from the existing QuickAPI test MySQL
service on `3308`. If database startup fails because its port is occupied, stop
there: do not continue to migrations or tests against the service on that port.
Update both the Compose mapping and `DB_PORT` together when selecting another port.

Coverage thresholds and exclusions are defined in [vitest.config.ts](../vitest.config.ts). CI gates coverage from the unit project; integration and E2E run as separate jobs. Passing that gate does not imply combined-suite coverage or complete runtime protection.

## HTTP lifecycle evidence

The milestone-one completion review adds focused regression cases for credentialed
CORS and exact origins, controller lookups that outlive a response deadline, a real
MySQL update blocked until after HTTP timeout, probe acquisition after shutdown,
and concurrent rate-limit bursts. `unit/request-timeout.test.ts` distinguishes
`writableEnded` from `writableFinished` and checks timer/listener cleanup directly,
so this state transition does not depend on operating-system socket buffer sizes.

`integration/database-readiness.test.ts` exercises real disposable MySQL behind a
controllable TCP proxy. It verifies connectivity loss and recovery on the same
application, silent query stalls, occupied-pool acquisition, released connections,
unapplied migrations, and absent migration history. The migration table is renamed
only inside the safety-guarded disposable schema and restored in `finally`.
`unit/database-readiness.test.ts` checks shared ownership, late acquisitions,
cache lifetime, and cancellation. See the [database lifecycle](../docs/database-lifecycle.md).

`integration/http-lifecycle.test.ts` uses real listeners and raw sockets for bind
failure, slow headers/body, delayed responses, disconnects, partial responses,
keep-alive reuse, and finite drain. `integration/lifecycle-process.test.ts` runs
isolated processes for readiness withdrawal, cleanup ordering, stuck work, and
forced exit 1. Its portable control emits SIGTERM inside the child on Windows;
the production container smoke sends the actual operating-system signal.
`integration/http-database-drain.test.ts` verifies that disconnected accepted work
can still query real disposable MySQL before shutdown closes it.

## Logging and metrics evidence

`test/unit/request-outcome.test.ts` verifies shared terminal-event observation,
listener cleanup, event races, and bounded method/route fallbacks.
`test/integration/request-telemetry.test.ts` exercises real disconnects before
and after headers, aborted uploads, full and partial response deadlines, completed
errors, repeated keep-alive requests, distinct router mounts, and bounded metric
series across many concrete URLs. It verifies that aborted responses never enter
completed-request counters or histograms and that logs and metrics share duration.
The privacy suites separately capture actual Pino output and request correlation.

These focused suites do not require MySQL or Docker:

```bash
npx vitest run --project unit test/unit/request-outcome.test.ts test/unit/logger-privacy.test.ts
npx vitest run --project integration test/integration/request-telemetry.test.ts test/integration/logging-privacy.test.ts
```

See [Logging and metrics](../docs/logging.md) for the metric contract, changed
route label values, transport boundaries, and deployment implications.

## PowerShell

Database wrappers and production smoke require Bash as well as Docker. On Windows,
use Git Bash with the same Node and Docker installation; the `bash` supplied by
WSL is a separate environment. Shell scripts are checked out with LF endings.
Alternatively, prepare infrastructure directly in PowerShell:

```powershell
npm.cmd run test:db:safety
if ($LASTEXITCODE -ne 0) { throw 'Database safety check failed' }
try {
  npm.cmd run test:infra:up
  if ($LASTEXITCODE -ne 0) { throw 'Infrastructure startup failed' }
  npm.cmd run test:infra:prepare
  if ($LASTEXITCODE -ne 0) { throw 'Database preparation failed' }
  npm.cmd run test:integration:run
  if ($LASTEXITCODE -ne 0) { throw 'Integration tests failed' }
  npm.cmd run test:e2e:run
  if ($LASTEXITCODE -ne 0) { throw 'E2E tests failed' }
  npm.cmd run test:migration:run
  if ($LASTEXITCODE -ne 0) { throw 'Migration validation failed' }
} finally {
  npm.cmd run test:infra:down
  $cleanupExitCode = $LASTEXITCODE
  if ($cleanupExitCode -ne 0) { Write-Warning 'Disposable database cleanup failed' }
}
if ($cleanupExitCode -ne 0) { throw 'Disposable database cleanup failed' }
```

Commands load [.env.test](../.env.test); existing process environment values take precedence. Keep the selected database disposable and retain teardown on failure.

Use `npm.cmd` in PowerShell when forwarding options: its native launcher preserves
the `--` separator, whereas `npm.ps1` can consume it before npm receives it.
For example, `npm.cmd run migration:run -- --fake --help` displays TypeORM help
without accessing a database. This verifies forwarding; it does not authorize
fake application to any schema. See [development](../docs/development.md#local-mysql-migrations-and-development).

Production smoke builds the runtime image and compares its HTTP favicon response
byte-for-byte with `public/favicon.ico`, checks its content type, and exercises
the existing API, migration, readiness, and real SIGTERM contracts. It also checks
the default non-root Node runtime and absence of bundled package managers/caches. From PowerShell
with Git installed at its default location:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' .github/scripts/ci-smoke.sh
if ($LASTEXITCODE -ne 0) { throw 'Production smoke failed' }
```

## Release candidate verification

`npm run test:release` runs infrastructure-free OCI identity, attestation, smoke
record, scanner-failure, tampering, and publication regressions. Base CI includes
these checks in its required dependency-security job.

The separate release workflow builds once and runs the real production smoke and
image scan against that candidate. It also tests publication in an internal,
disposable registry before authenticating to the configured release registry.
`npm run test:release:registry` is opt-in: set `RELEASE_REGISTRY_TEST=true`,
`RELEASE_TEST_ARCHIVE` to the verified OCI archive, and `RELEASE_TEST_EVIDENCE` to
its evidence directory. Otherwise the infrastructure test explicitly skips.
It uses a separate evidence copy, network, and registry container, publishes no
host port, and removes its resources afterward.

See [immutable releases](../docs/releases.md) for candidate commands, platform
requirements, release permissions, retained evidence, and rollback boundaries.

## Item failures and migration-history evidence

The integration suite includes `item-database-faults.test.ts` and
`migration-history.test.ts`. The former uses the real application and repository
behind a packet-aware MySQL fault proxy, with independent SQL assertions. It
checks offline CRUD/recovery, dropped writes before execution, committed writes
with lost acknowledgements, delayed lookups beyond HTTP deadlines, and repeated
single-slot pool recovery. The latter reproduces a replaced-baseline history
mismatch, checks failed startup/migration preservation, and verifies an explicitly
reviewed equivalent-baseline fake application in its disposable fixture only.

```bash
npm run test:integration -- test/integration/item-database-faults.test.ts test/integration/migration-history.test.ts
```

No fixture resets a development database, rewrites a committed migration, or
changes the application's retry/error behavior. The query proxy is intended for
unencrypted, default-attribute MySQL test connections; TLS has its own suite.
See [persistence evidence](../docs/persistence-evidence.md) for outcomes,
reconciliation prerequisites, rollback limits, and future upgrade/concurrency
evidence. New migrations still need representative-data upgrade tests when
their schema and backfill contracts are implemented.

## Controller and operation boundaries

`http-response.handler.test.ts` verifies shared JSON/text response mapping,
status/content types, error forwarding, late-result suppression, operation abort
on timeout/disconnect, and continued work tracking. Expected cooperative stops
are distinguished from genuinely failed late work. The adapter suite also passes
a bound service method directly and verifies that parsed query values reach the
repository, with unknown input fields removed. `items.service.test.ts` checks
missing-item behavior, PATCH/PUT semantics, and use of the supplied manager for
transactional lookups and writes. `transaction.helper.test.ts` checks ambient
request isolation, non-HTTP work, nested manager reuse, clock expiry, abandonment
before acquisition, expiry during acquisition, rollback, and cleanup only after
work settles. These unit tests need no MySQL.

The integration/E2E suites exercise the adapters and services through the same
HTTP routes/status/DTO contracts. Real-MySQL tests hold lookup and mutation results
past deadlines, or disconnect clients during mutations, then establish rollback
and unchanged rows through an independent connection. They also retain lost-COMMIT
acknowledgement evidence: an already-started commit can succeed without a response.
Cancellation does not interrupt SQL or undo external side effects. Custom streaming
handlers retain the lower-level tracked-handler boundary rather than using a
JSON/text adapter.

`handler-transaction.test.ts` checks that response preparation runs once, success
waits for commit, and commit failure produces an error rather than success.
`response-transaction.test.ts` uses disposable MySQL to verify rollback after DTO
and serialization failures for all four item mutations, one transaction across
multiple service/repository calls, later-step failure rollback, post-failure pool
reuse, and parity with default Express JSON serialization. Services keep their standalone atomic
workflows; HTTP mutation handlers extend the same transaction through response
preparation. Reads and system routes do not acquire handler transactions.

## Item revision evidence

`item-revisions.test.ts` runs real-MySQL HTTP tests for revisioned reads, no-op
increments, stale/missing/invalid preconditions, version bounds, conditional SQL,
and concurrent edit/edit, edit/delete, and delete/delete outcomes. The deletion
contract is POST `/api/v1/items/:id/delete` with JSON `expected_version`.
`item-revision-migration.test.ts` verifies upgrades over populated predecessor
schemas, microsecond timestamp preservation, default/backfill/index behavior,
pending-migration readiness refusal, and offline schema down/re-up. Existing
fault/response tests continue to verify revision rollback through timeouts,
disconnects, invalid DTOs, and failed JSON serialization. Production smoke uses
the same revisioned mutation contract and compiled migration artifacts.

## Item price and query evidence

`item-price.test.ts` covers accepted exact decimal spellings, fractional/boundary
values, rejected types and excess precision, filter rules, and safe page/offset
arithmetic. OpenAPI tests verify the numeric bounds and cent-sized precision
metadata. `item-data-contracts.test.ts` verifies MySQL round trips, unchanged
rows/revisions after invalid writes, decimal filter boundaries, and ID tie-breaking
across adjacent pages for every sort and direction. No schema change or test
infrastructure change is needed. Offset pagination remains susceptible to shifts
between requests when rows are inserted, deleted, or reordered.

## Shared idempotency foundation evidence

`idempotency-contracts.test.ts` covers opaque keys, scope separation, stable
canonical fingerprints of normalized input, unsupported values, policy bounds,
successful response/body rules, and exact UTF-8 size boundaries. Environment tests
reject malformed configuration and excessive per-sweep row counts.

`idempotency-storage.test.ts` uses disposable MySQL to check unique claims, exact
JSON storage through the full 64 KiB limit, database-clock 24-hour expiry, expiry
equality, conditional deletion, transaction-local processing claims, and bodyless
responses. Invalid/oversized responses, duplicate SQL claims, and later failures
roll back item writes and replay state together. Completed records cannot be
completed again or have retention extended.

`idempotency-migration.test.ts` upgrades a populated predecessor schema, preserves
item data and migration history, verifies required indexes/schema metadata, checks
pending-migration startup refusal, and exercises offline down/re-up. The existing
revision migration test rolls back successor migrations before testing its older
schema, then restores them.

`idempotency-service.test.ts` exercises shared orchestration, input validation before
acquisition, definite versus uncertain lock results, storage failures, malformed
stored data, delayed acquisition, request abandonment, transaction nesting, commit
failure, rollback failure, and lock-release failure.

`idempotency-execution.test.ts` uses real MySQL for non-waiting contention across
separate pools, independent scopes/keys, one outer transaction across service calls,
exact replay without new writes, and unchanged retention after later item edits or
deletion. It checks rollback after business/SQL/DTO/JSON/size/finalization failures,
atomic expired-key replacement, and pool reuse after repeated failures. Controlled
fault injection verifies failed commit before execution, lost acknowledgement after
an actual successful commit, and connection disposal after release/rollback failure.
Barriers verify that abandoned asynchronous work and pending SQL retain their lock
and connection until settled, followed by rollback. Single-slot pools expose leaked
leases. Lost acknowledgement is simulated around a real commit; this is not proof
of every network partition/failover outcome.

`idempotency-header.test.ts` checks absence, opaque values, malformed/combined/array
values, raw duplicates, and transaction opt-in. OpenAPI tests check optional header
bounds, pattern and response statuses, and the absence of opt-in on other operations.
`idempotency-http.test.ts` exercises the actual application stack with disposable
MySQL: normalized replay with fresh correlation IDs, unchanged retention, later
edit/delete, no-key behavior, unsupported endpoint behavior, invalid/duplicate raw
headers, invalid input, semantic conflicts, busy keys, CORS/preflight, custom CORS
omission, and rate limiting. Handler fixtures cover bodyless replay, DTO/JSON/size
rollback, timeout and client disconnect, followed by successful retries after drain.

Scheduled cleanup and process restart/multi-process evidence remain deferred to
pass 5. Separate-pool contention proves database session
coordination, not the complete hosted multi-instance deployment contract.
