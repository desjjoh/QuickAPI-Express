# Development

[Documentation index](../README.md#documentation)

## Runtime requirements

- **Node.js:** `>=24 <25` (CI and the production image currently use Node `24.11.1`).
- **Package manager:** `npm@11.4.2`, as declared by `packageManager` in `package.json`.
- Use `npm ci` with the committed `package-lock.json`; do not substitute another package manager.
- Docker with the Compose plugin is required for MySQL-backed tests and container validation.

Install dependencies with:

```bash
npm ci
```

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

Unlike the NestJS project, this application uses ESM and Vitest. The lint configuration keeps those boundaries rather than copying CommonJS or Jest settings. Lint covers root configuration files as well as application and test TypeScript. Generated output, coverage, and reports are excluded.

[package.json](../package.json) is the complete command reference. See [Testing](../test/TESTING.md) for database wrappers, coverage, and platform requirements.
