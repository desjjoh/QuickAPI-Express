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

Validation uses Node 24.11.1 and locked installs:

1. formatting and linting (`check:format-lint`);
2. type-check and production build (`check:type-build`);
3. unit tests with coverage and uploaded reports;
4. integration tests against a MySQL service after the safety check and migrations;
5. end-to-end tests with the same isolated preparation;
6. migration drift validation against its own disposable schema; and
7. digest validation plus the production image smoke test.

The required `Deployment gate` job retains its name and requires every validation
job to succeed. Naming the workflow changes the displayed prefix from its file
path to `CI`; it does not rename the required job. Existing run history retains
its original labels and event types.

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
the existing API, migration, readiness, and real SIGTERM contracts. From PowerShell
with Git installed at its default location:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' .github/scripts/ci-smoke.sh
if ($LASTEXITCODE -ne 0) { throw 'Production smoke failed' }
```
