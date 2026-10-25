# Development

[Documentation index](../README.md#documentation)

## Runtime requirements

- **Node.js:** `>=24 <25` (CI and the production image currently use Node `24.22.1`).
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

### Operational endpoint exposure

`DOCS_ENABLED` controls `/docs`, `/docs-json`, and `/redoc` together.
`DIAGNOSTICS_ENABLED` controls `/info` and `/system`. `METRICS_ENABLED` controls
`/metrics`. Each optional flag accepts exactly `true` or `false`; empty values,
numeric values, and other spellings fail startup validation.

When omitted, all three default to `true` in development/test and `false` in
production. Explicit values override these defaults independently. Disabled
endpoints return the standard 404 response, including HEAD and documentation
asset requests. Restart the application after changing settings.

`/health` and `/ready` remain public. Readiness still evaluates dependencies,
but its public body contains only `ready`, `status`, and `timestamp`; dependency
names and probe timings are no longer exposed, in any environment.
See [deployment access restrictions](deployment.md#operational-endpoint-access)
before enabling metrics or diagnostics outside development.

### Proxy and CORS configuration

The HTTP policy keys use the same names as QuickAPI-NestJS. They are optional;
omitting them keeps the existing localhost CORS defaults, while proxy trust is
now disabled by default. Existing `.env` files are not updated automatically.

| Variable               | Default                                       | Validation and meaning                                                                                                                                                                               |
| ---------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUST_PROXY`          | Empty                                         | Comma-separated IPv4/IPv6 addresses or CIDRs for trusted transport proxies. Empty trusts none. Hostnames, named subnets, hop counts, booleans, and `/0` ranges are rejected.                         |
| `CORS_ORIGINS`         | `http://localhost:3000`                       | Nonempty comma-separated exact HTTP(S) origins: scheme, host, and optional port. No paths, trailing slashes, credentials, queries, fragments, wildcard, or `null` origin. Use canonical URL origins. |
| `CORS_METHODS`         | `GET,POST,PUT,DELETE,PATCH,OPTIONS`           | Nonempty comma-separated uppercase methods from GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS. This controls CORS, not route availability.                                                            |
| `CORS_ALLOWED_HEADERS` | `content-type,authorization,x-requested-with` | Comma-separated request header names; empty permits no non-safelisted preflight request headers. Configured names also survive sanitization, subject to blocked-header and proxy-trust rules.        |
| `CORS_EXPOSED_HEADERS` | `authorization,set-cookie`                    | Comma-separated response header names; empty exposes no additional headers. Browsers still prohibit JavaScript from reading `Set-Cookie`.                                                            |
| `CORS_CREDENTIALS`     | `true`                                        | Exactly `true` or `false`. The existing credential policy is preserved by default; origins always remain explicit.                                                                                   |
| `CORS_MAX_AGE_SECONDS` | `86400`                                       | Integer from 0 through 86400, advertising preflight cache duration. Zero disables that cache.                                                                                                        |

Lists trim whitespace around entries; empty entries inside nonempty lists are
invalid. Header names contain letters, digits, and hyphens. Preflight header
matching is case-insensitive. Actual supported routes and HTTP method/body
policies continue to apply independently of CORS.

OPTIONS requests carrying an Origin and Access-Control-Request-Method are checked
against configured methods and requested headers. Unsupported preflights and
unlisted origins return 403. Requests without an Origin remain supported for
server-to-server clients and probes. Responses reaching CORS include `Vary: Origin`,
including rejected and no-origin responses; OPTIONS also varies on
`Access-Control-Request-Method` and `Access-Control-Request-Headers`.

Custom allowed request headers survive sanitization, but adding a name does not
implement its application semantics. In particular, `Idempotency-Key` can be
configured later when item idempotency is implemented; this change adds no replay
behavior. See [deployment proxy requirements](deployment.md#proxy-and-browser-access)
before trusting any ingress.

### HTTP deadlines and shutdown configuration

All durations are optional integer milliseconds from 1 through 2147483647.
Empty values are invalid. Existing environment files receive defaults until updated.

| Variable                  | Default | Meaning                                                                                                   |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `HTTP_HEADERS_TIMEOUT_MS` | `5000`  | Server deadline for receiving complete headers.                                                           |
| `HTTP_REQUEST_TIMEOUT_MS` | `10000` | Server deadline for receiving the whole request, including headers and body.                              |
| `REQUEST_TIMEOUT_MS`      | `10000` | API response deadline, starting before body parsing and ending when the response finishes or disconnects. |
| `HTTP_DRAIN_TIMEOUT_MS`   | `25000` | Maximum wait for HTTP connections and tracked asynchronous handlers during shutdown.                      |
| `SHUTDOWN_TIMEOUT_MS`     | `30000` | Overall shutdown deadline, including pending startup and database cleanup; expiry forces exit code 1.     |

The header deadline must not exceed the complete-request deadline. HTTP drain must
be shorter than total shutdown, reserving time for database cleanup. These are
separate clocks: receiving a request does not finish its response deadline.
Transport deadline checks run periodically and are not precise scheduling guarantees.

Use the production `registerServer`/`HttpListener` wiring for transport deadlines;
calling `createApp().listen()` directly only installs Express middleware policies.
See [deployment shutdown behavior](deployment.md#http-deadlines-and-shutdown).

### Rate limiting configuration

`RATE_LIMIT_WINDOW_MS` defaults to `60000`, `RATE_LIMIT_MAX` to `200`, and
`RATE_LIMIT_MAX_CLIENTS` to `10000`. The quota remains an exact rolling window.
Configuration validates individual limits and their combined storage budget.
See [bounded rate limiting](rate-limiting.md) for ranges, 429 versus 503, expiry,
retry timing, memory bounds, and the process-local enforcement boundary.

### Database readiness configuration

For pool capacity, queue bounds, acquisition/connection deadlines, and TLS, see
[Database transport and capacity](database-settings.md). All six optional settings
are listed in the environment files. TLS is disabled by default locally; enabling
it requires a certificate-matching DNS host and enforces certificate verification.

The optional `DB_READINESS_TIMEOUT_MS` and `DB_READINESS_CACHE_MS` settings both
default to 1000 milliseconds. `DB_MIGRATION_CHECK_TIMEOUT_MS` defaults to 5000
milliseconds and bounds migration inspection after TypeORM initialization. All
three accept integer milliseconds from 1 through 2147483647; empty values fail
validation. See the [complete database lifecycle](database-lifecycle.md) for pool
ownership, cache behavior, timeout cleanup, recovery, and shutdown.

Startup now refuses unapplied migrations. Run migrations explicitly before starting
the API; readiness probes never apply them. Initial database connection/ORM setup
retains its existing driver timeout behavior.

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
See [migration-history reconciliation](persistence-evidence.md#verified-history-reconciliation)
for the old-baseline mismatch, required schema/data verification, and safe branch
switching. A failed CREATE TABLE is not proof that a migration is applied.

`npm run clean` removes only the repository's `dist/` directory using Node's built-in
filesystem API, then rebuilds it. No global or transitive cleanup package is required.

## Logging

For NestJS-style console output, production JSON fields, severity filtering,
and safe error logging, see [Logging](logging.md). `LOG_LEVEL=info` suppresses
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

Unlike the NestJS project, this application uses ESM and Vitest. The lint configuration keeps those boundaries rather than copying CommonJS or Jest settings. Lint covers root configuration files as well as application and test TypeScript. Generated output, coverage, and reports are excluded.

[package.json](../package.json) is the complete command reference. See [Testing](../test/TESTING.md) for database wrappers, coverage, and platform requirements.
