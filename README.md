# QuickAPI-Express

QuickAPI-Express is a TypeScript and Express 5 API backed by MySQL through TypeORM. The repository
contains an item CRUD API, operational endpoints, OpenAPI documentation, structured logging,
request-policy middleware, explicit schema migrations, disposable database tests, and a production
container smoke test. This document describes only the behavior currently implemented in the
repository.

## Runtime requirements

- **Node.js:** `>=24 <25` (CI and the production image currently use Node `24.11.1`).
- **Package manager:** `npm@11.4.2`, as declared by `packageManager` in `package.json`.
- Use `npm ci` with the committed `package-lock.json`; do not substitute another package manager.
- Docker with the Compose plugin is required for MySQL-backed tests and container validation.

Install dependencies with:

```bash
npm ci
```

## Architecture and execution paths

### Source layout

```text
src/
├── index.ts                         process entry point
├── application.ts                   lifecycle service graph
├── config/                          environment, HTTP, database, logging, metrics, docs, routes
├── migrations/                      TypeORM migrations
├── common/
│   ├── exceptions/                  typed HTTP errors
│   ├── handlers/                    startup and shutdown lifecycle
│   ├── helpers/                     shared helpers
│   ├── library/                     shared response/query models
│   ├── middleware/                  request policy, telemetry, validation, and error middleware
│   ├── routes/                      final not-found handler
│   └── store/                       request context storage
└── modules/
    ├── api/app/                     root and operational endpoints
    ├── api/v1/items/                item routes, controller, request models, and OpenAPI definitions
    └── domain/                      TypeORM entities and repository

test/
├── unit/
├── integration/
├── e2e/
└── helpers/database/                disposable-MySQL orchestration and safety guard
```

There is one HTTP process and one TypeORM `DataSource`; this is not a generated multi-service or
multi-version application. Routes currently comprise the application/operational routes and the
`/api/v1/items` resource.

### Startup path

1. Importing configuration loads `.env` through `dotenv/config`, validates the complete environment,
   and stops immediately on invalid or missing values.
2. `src/index.ts` registers the service graph with the lifecycle handler.
3. Startup initializes MySQL/TypeORM first and then creates the Express listener. A database failure
   therefore prevents the HTTP port from opening.
4. If a later service fails, already initialized services are stopped in reverse order. A bootstrap
   failure is logged and shutdown sets a failing process exit code.

Startup deliberately does **not** synchronize the schema or run migrations
(`synchronize: false`, `migrationsRun: false`). Migrations are a separate operator/deployment step.

### Request path

Express serves the favicon/static files first. Application traffic then passes through metrics,
request-context and HTTP logging, security headers and rate limiting, header sanitization/limits,
request timeouts, content-type and method policies, CORS, and the body-size/parser middleware. It is
then dispatched to application routes, `/api/v1`, or the documentation routes (`/docs`,
`/docs-json`, and `/redoc`). Unknown routes become a typed 404.

Controllers validate inputs with Zod models and call the domain repository, which uses TypeORM.
Expected `HttpError` values, malformed JSON, and Zod failures are mapped to JSON error responses.
Unexpected failures are logged with request context and returned as a generic 500 so internal error
details are not disclosed. The error envelope contains `status`, `message`, and `timestamp`.

### Shutdown path

The lifecycle handler installs one-shot `SIGINT` and `SIGTERM` handlers and fatal handlers for
uncaught exceptions and unhandled rejections. Shutdown immediately makes readiness false, closes
initialized services in reverse startup order (HTTP listener first, then TypeORM), waits for the
listener to drain, and preserves a nonzero exit code for fatal or cleanup failures. Repeated shutdown
requests are ignored. This is the path exercised by the production SIGTERM smoke check.

## Configuration

Create `.env` for local development. Every variable below is consumed at startup:

```dotenv
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

DB_HOST=127.0.0.1
DB_PORT=3307
DB_USER=app
DB_PASSWORD=app
DB_DATABASE=quickapi

# Optional; defaults come from package.json
APP_NAME=quickapi-express
APP_VERSION=1.0.0
```

| Variable      | Validation and meaning                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`    | Required: exactly `development`, `test`, or `production`.                                                                                                 |
| `PORT`        | Required integer from `0` through `65535`; `0` (an ephemeral test listener) is allowed only when `NODE_ENV=test`, otherwise the port must be `1`–`65535`. |
| `LOG_LEVEL`   | Required: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`.                                                                                |
| `DB_HOST`     | Required non-empty MySQL host.                                                                                                                            |
| `DB_PORT`     | Required integer from `1` through `65535`.                                                                                                                |
| `DB_USER`     | Required non-empty MySQL user.                                                                                                                            |
| `DB_PASSWORD` | Required non-empty MySQL password.                                                                                                                        |
| `DB_DATABASE` | Required non-empty MySQL database/schema name.                                                                                                            |
| `APP_NAME`    | Optional; defaults to the package name.                                                                                                                   |
| `APP_VERSION` | Optional; defaults to the package version and, when supplied, must be full SemVer.                                                                        |

Values are trimmed/coerced where the schema specifies it. Validation prints all Zod issues to
stderr and throws before database or HTTP startup; there are no silent database defaults.

## Local MySQL, migrations, and development

The development Compose file provides MySQL 8.4.6 on host port `3307`, with schema `quickapi`, user
`app`, password `app`, and a persistent `mysql_data` volume. Start the database, apply migrations
explicitly using the `.env` above, and then start the source server:

```bash
docker compose up -d mysql
npm run migration:run
npm run dev
```

Alternatively, after migrations have been applied, `npm run docker:up` builds and starts both the API
and MySQL. Compose waits for MySQL health before starting the API, but it does **not** apply
migrations. `docker compose down` stops the stack while retaining data; use
`docker compose down --volumes --remove-orphans` only when intentionally deleting the development
database.

After changing an entity, use the fixed generation destination, review the generated migration, and
validate that no uncommitted schema difference remains:

```bash
npm run migration:generate
npm run migration:run
npm run migration:validate
```

`npm run migration:revert` reverts the most recently applied migration. All TypeORM commands use the
same validated environment as the application, so select the intended database before running them.

## Tests and database safety

Unit tests need no container. Integration, end-to-end, and migration tests use the wrapper commands,
which validate the target, start `docker-compose.test.yml`, wait for disposable MySQL, apply
migrations, run the selected Vitest project/validation, and always execute teardown from an `EXIT`
trap—even when startup or tests fail:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:migration
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

## Liveness, readiness, and operations

- `GET /health` is **process liveness**. It reports `alive`, uptime, and a timestamp; it does not query
  MySQL and should answer while the process is alive and not shutting down.
- `GET /ready` is **traffic readiness**. It returns 200 only after lifecycle startup completes and
  every registered service check passes (the TypeORM data source is initialized and the HTTP server
  is registered). Otherwise the normal error path returns 503. Readiness becomes false as soon as
  graceful shutdown starts.

Compose uses `/ready` for the API healthcheck. On `SIGTERM`, the process withdraws readiness, closes
the HTTP listener, destroys the database connection, and exits cleanly after in-flight listener work
drains.

Additional implemented endpoints are `/info`, `/system`, `/metrics`, `/docs`, `/docs-json`, and
`/redoc`.

## Package scripts

The following is the complete implemented script surface, with command bodies reproduced exactly
from `package.json`:

| Script                 | Exact definition                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`                  | `node --watch --import tsx src/index.ts`                                                                                                        |
| `build`                | `tsc -p tsconfig.build.json && tsc-alias`                                                                                                       |
| `typecheck`            | `tsc --noEmit`                                                                                                                                  |
| `clean`                | `rimraf dist && npm run build`                                                                                                                  |
| `start`                | `node dist/index.js`                                                                                                                            |
| `rebuild`              | `npm run build && npm start`                                                                                                                    |
| `test`                 | `vitest`                                                                                                                                        |
| `check:format-lint`    | `npm run format && npm run lint`                                                                                                                |
| `check:type-build`     | `npm run typecheck && npm run build`                                                                                                            |
| `test:unit`            | `vitest run --project unit`                                                                                                                     |
| `test:unit:coverage`   | `vitest run --project unit --coverage`                                                                                                          |
| `test:integration`     | `bash test/helpers/database/run-with-infra.sh integration`                                                                                      |
| `test:integration:run` | `vitest run --project integration`                                                                                                              |
| `test:e2e`             | `bash test/helpers/database/run-with-infra.sh e2e`                                                                                              |
| `test:e2e:run`         | `vitest run --project e2e`                                                                                                                      |
| `test:migration`       | `bash test/helpers/database/run-with-infra.sh migration`                                                                                        |
| `test:db:safety`       | `node --env-file=.env.test --import tsx test/helpers/database/safety.ts`                                                                        |
| `test:infra:up`        | `npm run test:db:safety && docker compose -f docker-compose.test.yml up -d --wait`                                                              |
| `test:infra:prepare`   | `npm run test:db:safety && node --env-file=.env.test --import tsx ./node_modules/typeorm/cli.js migration:run -d src/config/database.config.ts` |
| `test:infra:logs`      | `docker compose -f docker-compose.test.yml logs`                                                                                                |
| `test:infra:down`      | `npm run test:db:safety && docker compose -f docker-compose.test.yml down --volumes --remove-orphans`                                           |
| `test:coverage`        | `vitest run --coverage`                                                                                                                         |
| `coverage`             | `vitest run --coverage`                                                                                                                         |
| `lint`                 | `eslint .`                                                                                                                                      |
| `lint:fix`             | `eslint . --fix`                                                                                                                                |
| `format`               | `prettier --check .`                                                                                                                            |
| `quality`              | `npm run format && npm run lint && npm run typecheck && npm run test -- --run && npm run test:coverage && npm run build`                        |
| `format:fix`           | `prettier --write .`                                                                                                                            |
| `typeorm`              | `node --import tsx ./node_modules/typeorm/cli.js`                                                                                               |
| `migration:generate`   | `npm run typeorm -- migration:generate src/migrations/SchemaUpdate -d src/config/database.config.ts`                                            |
| `migration:run`        | `npm run typeorm -- migration:run -d src/config/database.config.ts`                                                                             |
| `migration:revert`     | `npm run typeorm -- migration:revert -d src/config/database.config.ts`                                                                          |
| `migration:validate`   | `npm run typeorm -- migration:generate src/migrations/SchemaValidation -d src/config/database.config.ts --check`                                |
| `docker:build`         | `docker build -t quickapi-express .`                                                                                                            |
| `docker:run`           | `docker run -dp 3000:3000 quickapi-express`                                                                                                     |
| `docker:up`            | `docker compose up --build`                                                                                                                     |
| `smoke:production`     | `bash .github/scripts/ci-smoke.sh`                                                                                                              |

The CI-oriented `check:*`, coverage, database-backed wrapper, migration validation, and production
smoke commands are intentionally listed rather than implying nonexistent shortcuts.

## Production image and smoke validation

`Dockerfile` uses three stages: a full locked install compiles TypeScript; a second locked install
retains production dependencies only; and the final Node 24.11.1 Alpine image receives `dist`, package
metadata, and production `node_modules`. The runtime includes `curl`, exposes port 3000, runs as the
non-root `node` user, and starts with `npm start`.

Build the image:

```bash
npm run docker:build
```

`npm run docker:run` reproduces the package's minimal `docker run` command, but a real API run must
also supply all required environment variables, a reachable migrated MySQL database, and typically a
container network. For example, the Compose topology supplies those settings; apply migrations
before bringing up its API as described above.

The canonical production validation is:

```bash
npm run smoke:production
```

It validates Compose configuration, builds the production image once, starts isolated MySQL, runs
the compiled migration CLI as a one-shot deployment step, starts the API, and verifies readiness and
liveness, security headers, absence of `x-powered-by`, item CRUD, validation/content-type/not-found
errors, and their JSON envelope. It then sends `SIGTERM` and verifies readiness withdrawal, listener
drain, container exit, and exit code 0. Its trap prints service logs on failure and always removes
containers, volumes, orphans, and temporary files. It requires `docker`, Docker Compose, `curl`, and
`node`.

## Continuous integration and deployment gate

`.github/workflows/ci.yml` runs on every push and pull request with Node 24.11.1 and locked installs:

1. formatting and linting (`check:format-lint`);
2. type-check and production build (`check:type-build`);
3. unit tests with coverage and uploaded reports;
4. integration tests against a MySQL service after the safety check and migrations;
5. end-to-end tests with the same isolated preparation;
6. migration drift validation against its own disposable schema; and
7. digest validation plus the production image smoke test.

The final `deployment-gate` job uses `if: always()` and depends on every validation job. It is the
explicit status intended for branch protection or a downstream deployment to require. At present,
however, its shell loop also checks `LOCKFILE_CONSISTENCY_RESULT` without defining that environment
variable or declaring a lockfile-consistency job. Consequently, the gate cannot pass as written even
when its seven declared dependencies succeed. This is fail-closed behavior, not a successful release
signal; fix the workflow before enabling deployment from the gate. This repository does not itself
deploy an application.

## Releases and image publication

**Image publication is not applicable in the current repository.** There is no tag/release workflow,
registry login, image push, provenance/signing step, or deployment workflow. A release therefore
requires an external/manual process after the validation jobs succeed and the gate defect above is
corrected. Add and document a dedicated, authenticated publication workflow before treating
`quickapi-express` as a published image; the existing `docker:build` and smoke scripts create and
validate local images only.

## License

[MIT](LICENSE)

---

QuickAPI-Express — part of the **QuickAPI** template ecosystem by **John Desjardins**.
