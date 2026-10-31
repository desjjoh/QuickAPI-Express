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

The disposable Compose project is `quickapi-express-test`. Test npm commands select
it explicitly, independently of the persistent `quickapi-express-dev` project.
Development `infra:*` commands use port 3309 and retain a named data volume; they
are not test setup/teardown commands.

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

The required `Deployment gate` requires every prerequisite validation job to
succeed. Workflow files define the checks; saved GitHub branch-protection settings
must be verified independently when changing required checks.

`npm run test:security` runs the Node gate regressions independently of Vitest,
using synthetic reports and fake command runners. It covers critical-only
blocking, exact/expired/invalid exceptions, incomplete evidence, command failures,
and image/archive/config identity. It needs no Docker, database, or registry.
`npm run check` includes it. Real `security:audit` and `security:image` invocations
require network access; image scanning also requires Docker. Raw reports and
decisions are retained on CI failure. See [security lifecycle](security.md)
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
so native-MySQL workflows remain supported. See [database settings](configuration.md#database-capacity-and-tls)
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
fake application to any schema. See [setup](setup.md#local-mysql-migrations-and-development).

## Production image verification

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

See [immutable releases](deployment.md#release-and-rollback) for candidate commands, platform
requirements, release permissions, retained evidence, and rollback boundaries.

## Regression map

The suites below exercise existing boundaries; they do not establish every
production network, failover, or deployment outcome.

| Boundary                                                            | Suites                                                                                                                                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP deadlines, disconnects, draining, and process exit             | [HTTP lifecycle](../test/integration/http-lifecycle.test.ts), [process lifecycle](../test/integration/lifecycle-process.test.ts), [database drain](../test/integration/http-database-drain.test.ts) |
| Readiness, shared probes, migration refusal, outage/recovery        | [Database readiness](../test/integration/database-readiness.test.ts)                                                                                                                                |
| Request outcomes, bounded metrics, and logging privacy              | [Request telemetry](../test/integration/request-telemetry.test.ts), [logging privacy](../test/integration/logging-privacy.test.ts)                                                                  |
| Database faults, lost commit acknowledgements, and history mismatch | [Item faults](../test/integration/item-database-faults.test.ts), [migration history](../test/integration/migration-history.test.ts)                                                                 |
| Transaction ownership and response-preparation rollback             | [Response transactions](../test/integration/response-transaction.test.ts), [transaction helper](../test/unit/transaction.helper.test.ts)                                                            |
| Revisions, competing mutations, and predecessor upgrades            | [Item revisions](../test/integration/item-revisions.test.ts), [revision migration](../test/integration/item-revision-migration.test.ts)                                                             |
| Decimal round trips, filters, and deterministic pagination          | [Item data contracts](../test/integration/item-data-contracts.test.ts)                                                                                                                              |
| Durable claims, storage bounds, retention, and replay               | [Storage](../test/integration/idempotency-storage.test.ts), [execution](../test/integration/idempotency-execution.test.ts), [HTTP](../test/integration/idempotency-http.test.ts)                    |
| Cleanup, process loss, restart, and mutation replay                 | [Cleanup](../test/integration/idempotency-cleanup.test.ts), [process](../test/integration/idempotency-process.test.ts), [mutation replay](../test/integration/item-mutation-replay.test.ts)         |

Real-MySQL fault checks use independent reads and server connection inspection;
response timeout does not cancel SQL. A lost acknowledgement after COMMIT can
leave committed data without a successful response. See [database failure
boundaries](architecture.md#database-lifecycle),
[transaction ownership](architecture.md#request-path), and
[idempotency failure evidence](architecture.md#request-idempotency-implementation).

The fault proxy uses unencrypted MySQL; it does not establish TLS behavior.
The separate TLS suite qualifies certificate acceptance/rejection and transport.
Portable process tests emit the registered signal handler inside child processes
on Windows; production smoke sends a real SIGTERM to the compiled container.
Deployment ingress, backup restoration, and arbitrary writer failover still need
environment-owned verification.

## Disposable TLS fixtures

These certificates and the server private key are public test fixtures, never
deployment credentials. The CA private key is not retained. The normal certificate
has a localhost DNS SAN; the wrong-name and expired certificates use the same test
server key and CA. The normal CA/server certificates expire in 2046. Regenerate
these fixtures before expiry. They are mounted only in the isolated TLS test service.
