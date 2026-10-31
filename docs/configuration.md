# Configuration

[Documentation index](../README.md#documentation)

## Sources and validation

[Environment validation](../src/config/env.config.ts) loads `.env` through dotenv;
already supplied process variables take precedence. Invalid settings print Zod
issues to stderr and throw before database or HTTP startup. Restart after changes.
[.env.example](../.env.example) documents host-development values, not production
credentials. Optional values use schema defaults when omitted; an empty value is
not generally equivalent to omission.

The schema and maintained examples define accepted values and defaults. Database, rate-limit, and replay settings are documented below; runtime behavior
belongs in Architecture and Security.
Follow [Setup](setup.md) for installation and startup commands.

## Required settings

Copy `.env.example` to a gitignored `.env` for local development. Its required
database values match the persistent development Compose service. The required runtime settings are:

```dotenv
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

DB_HOST=127.0.0.1
DB_PORT=3309
DB_USER=app
DB_PASSWORD=app
DB_DATABASE=quickapi

# Optional; defaults come from package.json
# Omit APP_NAME and APP_VERSION to use current package metadata.
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
names and probe timings are not exposed in any environment.
See [deployment access restrictions](deployment.md#operational-endpoint-access)
before enabling metrics or diagnostics outside development.

### Proxy and CORS configuration

The HTTP policy keys use the same names as QuickAPI-NestJS. They are optional;
omitting them uses localhost CORS defaults and disables proxy trust. Existing `.env` files are not updated automatically.

| Variable               | Default                                                       | Validation and meaning                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUST_PROXY`          | Empty                                                         | Comma-separated IPv4/IPv6 addresses or CIDRs for trusted transport proxies. Empty trusts none. Hostnames, named subnets, hop counts, booleans, and `/0` ranges are rejected.                         |
| `CORS_ORIGINS`         | `http://localhost:3000`                                       | Nonempty comma-separated exact HTTP(S) origins: scheme, host, and optional port. No paths, trailing slashes, credentials, queries, fragments, wildcard, or `null` origin. Use canonical URL origins. |
| `CORS_METHODS`         | `GET,POST,PUT,DELETE,PATCH,OPTIONS`                           | Nonempty comma-separated uppercase methods from GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS. This controls CORS, not route availability.                                                            |
| `CORS_ALLOWED_HEADERS` | `content-type,authorization,x-requested-with,idempotency-key` | Comma-separated request header names; empty permits no non-safelisted preflight request headers. Configured names also survive sanitization, subject to blocked-header and proxy-trust rules.        |
| `CORS_EXPOSED_HEADERS` | `authorization,set-cookie`                                    | Comma-separated response header names; empty exposes no additional headers. Browsers still prohibit JavaScript from reading `Set-Cookie`.                                                            |
| `CORS_CREDENTIALS`     | `true`                                                        | Exactly `true` or `false`. The existing credential policy is preserved by default; origins always remain explicit.                                                                                   |
| `CORS_MAX_AGE_SECONDS` | `86400`                                                       | Integer from 0 through 86400, advertising preflight cache duration. Zero disables that cache.                                                                                                        |

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

Custom allowed request headers survive sanitization. `Idempotency-Key` is preserved
independently of that list and is included in default CORS request headers. Custom
`CORS_ALLOWED_HEADERS` must include it for keyed browser mutations. All item mutation routes opt into replay; reads and system endpoints ignore the
header. PATCH, PUT and the deletion action still require `expected_version`. See
[deployment proxy requirements](deployment.md#proxy-and-browser-access) before
trusting any ingress.

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
See [bounded rate limiting](security.md#rate-limiting) for ranges, 429 versus 503, expiry,
retry timing, memory bounds, and the process-local enforcement boundary.

### Database readiness configuration

For pool capacity, queue bounds, acquisition/connection deadlines, and TLS, see
[Database transport and capacity](configuration.md#database-capacity-and-tls). The maintained examples list the optional settings. TLS is disabled by default locally; enabling
it requires a certificate-matching DNS host and enforces certificate verification.

The optional `DB_READINESS_TIMEOUT_MS` and `DB_READINESS_CACHE_MS` settings both
default to 1000 milliseconds. `DB_MIGRATION_CHECK_TIMEOUT_MS` defaults to 5000
milliseconds and bounds migration inspection after TypeORM initialization. All
three accept integer milliseconds from 1 through 2147483647; empty values fail
validation. See the [complete database lifecycle](architecture.md#database-lifecycle) for pool
ownership, cache behavior, timeout cleanup, recovery, and shutdown.

Startup refuses unapplied migrations. Run migrations explicitly before starting
the API; readiness probes never apply them. Initial database connection/ORM setup
retains its existing driver timeout behavior.

## Shared idempotency policy

The maintained environment examples expose `IDEMPOTENCY_MAX_RESPONSE_BYTES`,
`IDEMPOTENCY_CLEANUP_BATCH_SIZE`, and `IDEMPOTENCY_CLEANUP_MAX_BATCHES`.
[Retention and bounded storage](architecture.md#request-idempotency-implementation)
defines their defaults, bounds, and combined sweep limit. Retention is fixed at
24 hours and cleanup is scheduled hourly, with no startup sweep. Restart after
changing settings; existing local `.env` files are not updated automatically.

Keep `APP_NAME` and `DB_DATABASE` stable across replicas and compatible releases:
they define the shared replay namespace. Without a key, a retry can execute a new
mutation. See [cleanup lifecycle](architecture.md#request-idempotency-implementation) for failure and
shutdown behavior.

## Development and disposable tests

| Context                       | Project and configuration            | Database target                                            |
| ----------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| Host development              | `quickapi-express-dev`, `.env`       | `127.0.0.1:3309`, schema `quickapi`, persistent volume     |
| Local integration/E2E         | `quickapi-express-test`, `.env.test` | `127.0.0.1:3318`, schema `quickapi_disposable_test`, tmpfs |
| Containerized development API | Development Compose overrides        | `mysql:3306` on the internal network                       |

The app does not select `.env.test` automatically from `NODE_ENV`. Test commands
explicitly load that file; process environment values still take precedence.
[Test safety](testing.md#tests-and-database-safety) rejects unsafe targets. Never
substitute development connection values for disposable test settings.

The local Compose credentials are development-only. Production connection values,
TLS CA files, ingress policy, and operational endpoint access must be supplied by
the deployment owner. There is no Redis or external authentication-provider
configuration in the current application.

## Database capacity and TLS

The settings below are optional and take effect after restart. Examples appear in
[.env.example](../.env.example) and [.env.test](../.env.test); local `.env` files
are not updated automatically. See [Configuration](configuration.md) for loading and
environment selection.

| Setting                      | Default | Validation and purpose                                                                                                     |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `DB_POOL_CONNECTION_LIMIT`   | `10`    | Integer 1–1000; maximum leased/connecting connections per data source/process.                                             |
| `DB_POOL_QUEUE_LIMIT`        | `50`    | Integer 0–10000; maximum waiting acquisitions. Zero fails immediately when capacity is occupied; it never means unlimited. |
| `DB_POOL_ACQUIRE_TIMEOUT_MS` | `1000`  | Integer 1–2147483647; total caller wait for a lease, including queue time and connection setup.                            |
| `DB_CONNECT_TIMEOUT_MS`      | `10000` | Integer 1–2147483647; maximum connection setup through completion of authentication/TLS.                                   |
| `DB_SSL`                     | `false` | Exactly `true` or `false`; explicitly enable for encrypted deployments.                                                    |
| `DB_SSL_CA_FILE`             | Unset   | Nonempty readable PEM CA bundle path. Requires `DB_SSL=true`; omit to use Node's default trust roots.                      |

Empty numeric/boolean values, fractional limits, and excessive values fail environment
validation. CA files are loaded and validated when constructing database options;
an unreadable or invalid bundle fails startup with `DB_TLS_CONFIG`.
Paths are interpreted relative to the process working directory unless absolute.

Pool limits multiply by application instance count. Ten connections across five
instances can use fifty server connections, plus migration tools, administrative
clients, or other applications. Select capacity against MySQL's server limit and
leave headroom. A larger pool is not automatically faster.

### Database TLS

With `DB_SSL=true`, connections require TLS 1.2 or newer, a trusted certificate
chain, and a DNS server identity matching `DB_HOST`. There is no verification-bypass
setting and no plaintext fallback. A private CA should be mounted into the process
and selected with `DB_SSL_CA_FILE`; never use the committed test certificates.

TLS requires a **DNS hostname**, not an IP literal. The installed mysql2 driver
skips its pre-authentication identity check for IP hosts; configuration rejects that
combination rather than checking identity after credentials have already been sent.
Use a DNS name listed in the server certificate's SAN. Local plaintext development
can continue using `127.0.0.1` with TLS off. Production defaults do not silently turn
TLS on: enable it deliberately for the deployment and configure its CA/hostname.

Example deployment overrides:

```dotenv
DB_HOST=mysql.internal.example
DB_SSL=true
DB_SSL_CA_FILE=/run/secrets/mysql-ca.pem
DB_POOL_CONNECTION_LIMIT=10
DB_POOL_QUEUE_LIMIT=50
DB_POOL_ACQUIRE_TIMEOUT_MS=1000
DB_CONNECT_TIMEOUT_MS=10000
```

Use the same settings and mounted CA for deployment migration commands. Certificate
changes require replacing the mounted file and restarting processes so new options
and pools are created. Never log CA contents or introduce credential-bearing error
messages to diagnose failures; recognized transport codes use safe diagnostics.

## Rate-limit settings

Settings are optional validated integers. Empty, nonnumeric, fractional, zero, and
negative values are rejected at startup. Direct middleware construction validates
the same policy. Restart after changing environment values.

| Variable                 | Default | Allowed range                                             |
| ------------------------ | ------- | --------------------------------------------------------- |
| `RATE_LIMIT_WINDOW_MS`   | `60000` | 1 through 86400000 milliseconds (one day).                |
| `RATE_LIMIT_MAX`         | `200`   | 1 through 10000 admitted requests per client per window.  |
| `RATE_LIMIT_MAX_CLIENTS` | `10000` | 1 through 100000 concurrently retained client identities. |

The product of the two capacity settings must not exceed **2000000 timestamp
slots**. Raising the request quota may therefore require reducing client capacity.
At the default maximum occupancy, timestamp buffers occupy 16000000 bytes
(approximately 15.3 MiB), plus client records, map/key storage, and runtime overhead.
This is a timestamp-allocation bound, not a complete process-memory limit.

## Replay limits

| Setting                           | Default | Bounds                       |
| --------------------------------- | ------- | ---------------------------- |
| `IDEMPOTENCY_MAX_RESPONSE_BYTES`  | `65536` | Integer UTF-8 bytes, 1–65536 |
| `IDEMPOTENCY_CLEANUP_BATCH_SIZE`  | `100`   | Integer rows, 1–1000         |
| `IDEMPOTENCY_CLEANUP_MAX_BATCHES` | `10`    | Integer batches, 1–100       |

Batch size multiplied by batch count must not exceed 10000 rows per sweep. Empty,
fractional, nonfinite, and out-of-range values fail startup validation. Retention
is fixed at 24 hours and the sweep interval at one hour. Defaults allow at most
1000 deletions per process per sweep. Replica sweeps do not share a leader.
