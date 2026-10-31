# Setup

[Documentation index](../README.md#documentation)

## Runtime requirements

- **Node.js:** `>=24 <25` (CI and the production image currently use Node `24.22.1`).
- **Package manager:** `npm@11.4.2`, as declared by `packageManager` in `package.json`.
- Use `npm ci` with the committed `package-lock.json`; do not substitute another package manager.
- Docker with the Compose plugin is required for the default development database, MySQL-backed tests, and container validation.

Install dependencies with:

```bash
npm ci
```

## Local configuration

Copy [.env.example](../.env.example) to a gitignored `.env` (`Copy-Item .env.example .env`
in PowerShell). Its required database values match persistent development MySQL.
Review [Configuration](configuration.md) for validated settings, optional overrides,
CORS, and test isolation. Omit `APP_VERSION` unless intentionally overriding the
version supplied by `package.json`.

## Local MySQL, migrations, and development

`docker-compose.yaml` provides MySQL 8.4.6 bound to `127.0.0.1:3309`, with schema
`quickapi`, user/password `app`, and a persistent named volume
`quickapi-express-dev_mysql_data`. These credentials are for local development only.
Port 3309 keeps Express separate from NestJS development MySQL on 3307 and Express
tests on 3318. MySQL retains its internal port 3306; the containerized API connects
to `mysql:3306` rather than the published host port.

The fixed development Compose project is `quickapi-express-dev`; disposable tests
use `quickapi-express-test`. npm infrastructure commands select their project
explicitly, so test teardown cannot remove development containers or volumes.

Start the database, apply committed migrations, and start the source server:

```bash
npm run dev:db
npm run dev
```

`dev:db` runs `infra:up` followed by the explicit migration command. It does not
start the API or generate replacement migrations. To manage the database separately:

| Command                 | Behavior                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `npm run infra:up`      | Start development MySQL and wait for an authenticated query against the schema to succeed. |
| `npm run infra:status`  | Show development MySQL status.                                                             |
| `npm run infra:logs`    | Show the latest 200 development MySQL log lines.                                           |
| `npm run infra:stop`    | Stop MySQL while retaining its container and data.                                         |
| `npm run infra:down`    | Remove the development stack's containers/network while retaining its named data volume.   |
| `npm run migration:run` | Apply pending migrations to the database selected in `.env`.                               |

These npm commands work in Bash and PowerShell; use `npm.cmd` in PowerShell when
forwarding CLI options. `infra:up` does not start test infrastructure or run
migrations. `test:infra:*` commands remain reserved for disposable tests.

After migrations have been applied, `npm run docker:up` builds and starts both the
API and MySQL. Compose waits for MySQL health before starting the API, but it does
not apply migrations. Stop/down/up cycles preserve development data. Do not add
`--volumes` to development teardown unless intentionally deleting that database.
MySQL initialization credentials/schema apply only when the data volume is empty;
changing environment values does not migrate or reconfigure existing volume data.

An existing local MySQL database and older Docker volumes remain separate and are
not reset or imported automatically. To use an external development database,
explicitly override the five `DB_*` connection values in `.env` and run migrations
only after checking that target. Preserve migration history across branch changes.

For schema changes, generation/import handling, no-drift checks, branch changes,
and reviewed reconciliation, follow [Migrations](setup.md#database-migrations). The API never
applies migrations automatically. Do not use a destructive reset or fake migration
as a shortcut around pending-history checks.

`npm run clean` removes the repository's `dist/` directory and rebuilds it.

## Logging

For NestJS-style console output, production JSON fields, severity filtering,
and safe error logging, see [Logging](deployment.md#logging-and-metrics). `LOG_LEVEL=info` suppresses
successful request logs; use `debug` to include them. No additional environment
settings are required for production UTC timestamps or sensitive-field redaction.

## Readability conventions

Prettier owns indentation, wrapping, quotes, trailing commas, and line endings. Its configuration follows QuickAPI-NestJS: single quotes, trailing commas, and automatic line endings, with the remaining Prettier defaults. ESLint also reports Prettier violations as errors.

Source lint rules separate class methods and logical statement groups: leave a blank line after declarations before executable work, after block-like steps, and before returns, throws, and try blocks. Related declarations and class fields may stay grouped. Historical database migrations are excluded from these additional spacing rules and bulk Prettier formatting.

Use `npm run lint:fix` followed by `npm run format` for cleanup. Keep formatting behavior-preserving: do not reorder side effects or rewrite conditions to improve spacing. Comments should explain intent, invariants, and non-obvious limits. Keep the README short and place implementation contracts in the focused guides.

## Checks and command reference

| Command                     | Purpose                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run format`            | Write formatting across supported repository files                                                       |
| `npm run format:fix`        | Compatibility alias for `format`                                                                         |
| `npm run format:check`      | Check formatting without writing                                                                         |
| `npm run lint` / `lint:fix` | Check or fix ESLint and Prettier rules                                                                   |
| `npm run check`             | Formatting, lint, type checking, unit tests, and build                                                   |
| `npm run check:format-lint` | Read-only formatting and lint CI gate                                                                    |
| `npm run check:type-build`  | Type checking and production build                                                                       |
| `npm run quality`           | All Vitest projects, combined coverage, and static/build checks; requires a prepared disposable database |

The application uses ESM and Vitest. Lint covers root configuration files as well
as application and test TypeScript. Generated output, coverage, and reports are excluded.

[package.json](../package.json) is the complete command reference. See [Testing](testing.md) for database wrappers, coverage, and platform requirements.

## Database migrations

### Applying migrations

Run commands from the repository root against an explicitly selected database.
The API checks migration history before listening; it never synchronizes or
migrates the schema automatically. Start development MySQL and apply pending
migrations with `npm run dev:db`, or run `npm run migration:run` against an already
provisioned development database. See [Setup](setup.md#local-mysql-migrations-and-development).

Production migration jobs use the compiled TypeORM CLI directly with Node; the
runtime image does not contain npm. Apply every pending migration before API
replacement, using the same image and database/TLS configuration as the API.
See [Deployment](deployment.md) for writer compatibility and rollback ordering.

### Creating and inspecting changes

After changing an entity, use the fixed generation destination, review the generated migration, and
validate that no uncommitted schema difference remains:

```bash
npm run migration:generate
npm run migration:run
npm run migration:validate
```

`migration:generate` runs TypeORM and then fixes type-only imports and formatting
in newly generated TypeScript migrations. TypeORM's default template imports
interfaces as runtime values, which fails under this project's ESM and
`verbatimModuleSyntax` settings. Historical migrations are left untouched.
The generation command retains TypeORM's nonzero exit when no changes are found;
use `migration:validate` for a successful no-drift check.

`npm run migration:revert` reverts the most recently applied migration. All TypeORM commands use the
same validated environment as the application, so select the intended database before running them.

Migration run/revert/validation scripts invoke TypeORM directly. In Bash, append
options after `--`; in PowerShell use the native `npm.cmd` launcher so `npm.ps1`
does not consume that separator. These examples inspect help without connecting:

```bash
npm run migration:run -- --fake --help
```

```powershell
npm.cmd run migration:run -- --fake --help
```

Do not use `--fake` as a general migration repair: it records history without
executing SQL and requires prior verification that the migration's effects exist.
Preserve shared/applied migration files and add new migrations for subsequent
changes. Stop the watch server before switching branches with different schemas.
See [history reconciliation](#history-reconciliation)
for the old-baseline mismatch, required schema/data verification, and safe branch
switching. A failed CREATE TABLE is not proof that a migration is applied.

### Shared migrations and branch changes

Applied/shared migrations are immutable history. Add new migration files for new
schema changes; do not regenerate or rename an existing baseline after it has
been applied elsewhere. Switching Git branches changes source files, not the
schema or MySQL migration records. Stop the watch server before switching between
branches with different migration histories. Separate disposable schemas are
often easier for branches that intentionally have incompatible schemas.

A history mismatch can leave a table present while its baseline appears pending.
Startup refuses readiness, and applying a CREATE TABLE migration then fails with
`ER_TABLE_EXISTS_ERROR`. Neither failure repairs history or establishes that the
schema matches the migration. The migration-history fixture covers an explicitly
reviewed equivalent-baseline reconciliation; startup never performs one.

### History reconciliation

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

### Rollback and upgrade requirements

The initial migration's `down()` drops `items`. It is destructive teardown, not a
data-preserving production rollback. Rolling back an image does not undo schema
changes. Confirm that the previous application supports the current schema before
redeploying its [verified digest](deployment.md#release-and-rollback). Prefer a
compatible forward repair; any required restore needs a separately rehearsed
backup/recovery procedure.

These history fixtures establish handling of an already-existing baseline; they
do not establish a future upgrade/backfill's safety. With each future migration,
start from its actual predecessor containing representative rows and test data
preservation, backfills, defaults, indexes, deployment ordering, and supported
application-version compatibility. Existing revision and idempotency suites add
concurrency, replay, and cross-write rollback evidence; preserve and extend those
checks alongside future mutation contracts.

### Disposable verification

Use `npm run test:migration` for the guarded disposable no-drift check, or
`test:migration:run` only after preparing its test infrastructure. Revision and
idempotency migration suites exercise representative predecessor data, required
indexes, readiness refusal, and offline down/re-up. Follow [Testing](testing.md)
for commands and safety boundaries; passing a fresh-schema check alone does not
qualify an upgrade, data backfill, or production rollback.
