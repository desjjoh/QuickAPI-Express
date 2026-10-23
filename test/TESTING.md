# Testing

[Documentation index](../README.md#documentation)

## Tests and database safety

Unit tests need no container. Integration and end-to-end wrappers validate the target,
start `docker-compose.test.yml`, wait for disposable MySQL, apply migrations, and
execute teardown from an `EXIT` trap even when startup or tests fail. The wrappers
currently run their selected project twice; migration dispatch also needs correction
as described below. Use the explicit PowerShell sequence or CI's direct commands
when you need one test run per prepared database:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

The disposable service binds only to `127.0.0.1:3308` and stores MySQL data in `tmpfs`. Destructive
infrastructure commands first require all of the following:

- `NODE_ENV` is exactly `test`;
- `DB_DATABASE` matches `^[a-z0-9_]+_disposable_test$` and is not a protected generic name; and
- `DB_HOST` is a recognized local/CI host, or is explicitly included in the comma-separated
  `TEST_DB_ALLOWED_HOSTS` allowlist.

Set a safe test environment before using local infrastructure commands; for example,
`DB_DATABASE=quickapi_disposable_test` with `DB_HOST=localhost`. `npm run test:infra:down` removes
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

`npm run test` starts Vitest in watch mode. `test:integration:run` and `test:e2e:run` run their projects directly against already prepared infrastructure, as CI does. `test:coverage` runs all projects with coverage and likewise requires database preparation.

Coverage thresholds and exclusions are defined in [vitest.config.ts](../vitest.config.ts). CI gates coverage from the unit project; integration and E2E run as separate jobs. Passing that gate does not imply combined-suite coverage or complete runtime protection.

## HTTP lifecycle evidence

`integration/http-lifecycle.test.ts` uses real listeners and raw sockets for bind
failure, slow headers/body, delayed responses, disconnects, partial responses,
keep-alive reuse, and finite drain. `integration/lifecycle-process.test.ts` runs
isolated processes for readiness withdrawal, cleanup ordering, stuck work, and
forced exit 1. Its portable control emits SIGTERM inside the child on Windows;
the production container smoke sends the actual operating-system signal.
`integration/http-database-drain.test.ts` verifies that disconnected accepted work
can still query real disposable MySQL before shutdown closes it.

## PowerShell

Database wrapper and production smoke scripts require Bash as well as Docker. Use a Bash environment with access to the same Node and Docker installation, or prepare infrastructure explicitly in PowerShell and run the direct project commands:

```powershell
npm run test:db:safety
if ($LASTEXITCODE -ne 0) { throw 'Database safety check failed' }
try {
  npm run test:infra:up
  if ($LASTEXITCODE -ne 0) { throw 'Infrastructure startup failed' }
  npm run test:infra:prepare
  if ($LASTEXITCODE -ne 0) { throw 'Database preparation failed' }
  npm run test:integration:run
  if ($LASTEXITCODE -ne 0) { throw 'Integration tests failed' }
  npm run test:e2e:run
  if ($LASTEXITCODE -ne 0) { throw 'E2E tests failed' }
} finally {
  npm run test:infra:down
}
```

Commands load [.env.test](../.env.test); existing process environment values take precedence. Keep the selected database disposable and retain teardown on failure.

The Bash wrapper currently has a duplicate Vitest invocation and attempts to select a nonexistent `migration` project; see [backlog](../docs/backlog.md). For migration validation, prepare disposable infrastructure explicitly, run `npm run migration:validate`, and tear it down in `finally`.
