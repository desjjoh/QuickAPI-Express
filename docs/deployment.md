# Deployment and operations

[Documentation index](../README.md#documentation)

## Runtime packaging and smoke verification

The minimal Alpine runtime includes Node, compiled code, production dependencies,
package metadata, and `public/`, owned by the non-root `node` user. npm, npx, Yarn,
Corepack, and their download caches stay in build stages. Static assets retain
their existing middleware ordering; they bypass API logging/policy middleware as described in [Architecture](architecture.md#createapp-middleware-ordering).

[Dockerfile](../Dockerfile) pins the Node and Alpine build/runtime references and
uses the same musl release for native compatibility. The runtime contains required
native libraries and curl for readiness, and starts `node dist/index.js` as the
non-root user. Read the Dockerfile when updating versions rather than maintaining
a second patch-version inventory here.

Production deployment must supply required environment settings, a reachable
migrated MySQL database, trusted TLS/network policy, persistent storage, and
termination grace. The checked-in development Compose file is a local topology,
not a complete hosted production design. Run compiled migrations with Node, for
example `node node_modules/typeorm/cli.js migration:run -d dist/config/database.config.js`,
before API replacement; runtime overrides must not invoke npm.

See [Testing](testing.md#production-image-verification) for smoke commands and
checks, [Security](security.md#dependency-and-image-security) for scan gates, and
[Releases](deployment.md#release-and-rollback) for the immutable candidate/publication process. Passing a
local smoke check is not evidence of deployment, backup restoration, or real ingress.

## Replay-storage migration and keyed mutations

Apply all pending [migrations](setup.md#database-migrations) before starting API instances. Startup
rejects pending migrations. The replay-storage migration creates
`request_idempotency` and its expiry index; it does not change existing item data.
Records have no item foreign key because replay survives item deletion. Optional
keyed item creation, PATCH, PUT and deletion are enabled; no-key behavior is unchanged. Replicas
must share the MySQL writer, stable `APP_NAME`/`DB_DATABASE`, and the same scope and
fingerprint contract. Release rollback must retain that contract for unexpired keys.
All writer versions must enforce the same replay contract for enabled mutations.
Creation-only replay binaries cannot provide replay guarantees for PATCH/PUT/deletion;
coordinate writer replacement before clients rely on those retries.
Include `idempotency-key` in any custom CORS request-header list and preserve the
header through ingress without duplicating or rewriting its value.

The down migration drops replay history. It is an offline schema downgrade, not a
safe online rollback while keyed operations are enabled. Preserve verified replay
history during application rollback; do not regenerate baselines or reset a
development database to apply this migration. Each API process runs non-overlapping
hourly cleanup: defaults are 100 rows per batch, at most 10 batches per sweep. Only
expired completed records are deleted, using database UTC time. Cleanup quiesces
immediately on shutdown and drains after HTTP work, before MySQL closes. The overall
shutdown watchdog bounds stuck cleanup; running SQL is not cancelled. See the
[cleanup lifecycle](architecture.md#request-idempotency-implementation) for exact ordering and failures.

Logical expiry is independent of physical deletion. Failed/delayed sweeps cannot
extend replay eligibility. Monitor table growth: bounded batches, response size,
and 24-hour expiry do not impose an absolute storage cap at arbitrary throughput.
There is no distributed leader; replicas can safely issue their own conditional
deletes against the shared writer. Independent MySQL writers remain outside this
advisory-lock coordination contract.

## Proxy and browser access

`TRUST_PROXY` defaults to empty (no proxy trust). Deployments behind an ingress
must explicitly configure its actual IP addresses/CIDRs before relying on forwarded
client addresses, protocol, or host.
Use the same policy on every API instance and restart after changing environment
values. For example, if the ingress really connects from `10.20.0.10`:

```dotenv
TRUST_PROXY=10.20.0.10
CORS_ORIGINS=https://web.example.com,https://admin.example.com
```

Use this address only as an example, not a production default. Do not trust an
entire container/private network if untrusted workloads can connect from it.
The ingress must strip or overwrite client-supplied `X-Forwarded-For`,
`X-Forwarded-Host`, and `X-Forwarded-Proto`, and supply authoritative values.
Express resolves the client address from the socket through trusted hops to the
nearest untrusted address; see [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/).

Forwarding headers from untrusted transport peers are ignored and stripped,
rather than rejecting otherwise valid requests. Trusted peers retain the three
Express forwarding headers so rate limiting, request-context logs, and route
handlers use the same identity. Other forwarding formats such as `Forwarded`
and `Via` are not interpreted as identity and are removed by default. Protocol
and host trust depend on the ingress overwriting their headers correctly.

Set `CORS_ORIGINS` to the exact browser origins that should read API responses.
The other [CORS settings](configuration.md#proxy-and-cors-configuration) control
methods, request/response headers, credentials, and preflight caching. Caches
must honor the emitted `Vary` headers, including Origin and the preflight request
method/header fields. CORS is a browser response-access policy, not authentication
or authorization for this public item API.

Before release, verify real ingress requests and browser preflights, the logged
client IP, and that direct/untrusted forwarding cannot change the rate-limit
identity. Automated loopback/allowlist tests do not establish the real network
trust boundary. HTTP policy configuration requires no schema migration.

## Liveness, readiness, and operations

Rate limits are enforced independently by each API process. Configure bounded
client capacity and account for 503 responses when new identities cannot be
tracked. A cross-replica quota needs separate gateway/shared enforcement. The
application has no Redis dependency. See the [rate limiting lifecycle](security.md#rate-limiting).

- `GET /health` is **process liveness**. It reports `alive`, uptime, and a timestamp; it does not query
  MySQL and should answer while the process is alive and not shutting down.
- `GET /ready` is **traffic readiness**. It returns 200 only after lifecycle startup completes and
  every registered service check passes (a bounded database connectivity probe succeeds and the HTTP server
  is actually listening). Otherwise the normal error path returns 503. Readiness becomes false as soon as
  graceful shutdown starts.

Compose uses `/ready` for the API healthcheck. Startup resolves only after the
listener binds; a bind failure unwinds already-started services, including MySQL.

Before HTTP startup, the API verifies committed migration history and rejects
unapplied migrations. It does not apply them. During runtime, readiness requests
share one database probe and briefly cache its result; polling detects loss and
recovery without restarting the API. Configure the deployment to withdraw traffic
on readiness failure while leaving liveness independent. See the
[database lifecycle](architecture.md#database-lifecycle) for detection timing, connection cleanup,
pool exhaustion, startup failure, and recovery limits.

The public `/ready` body contains only `ready`, `status`, and `timestamp`. Checks
run internally; dependency names and timings are not returned. Consumers must use
readiness status rather than an internal dependency breakdown.

## Database capacity and TLS

Database deployment settings are covered in [Database transport and capacity](configuration.md#database-capacity-and-tls).
Size the per-instance pool against total server capacity, choose bounded queue/wait
budgets, and explicitly enable TLS with a trusted CA and certificate-matching DNS
host. Migration jobs need the same CA/settings. Acquisition deadlines do not cancel
running SQL; the established HTTP drain-before-pool-close ordering remains intact.

## Item revision rollout and rollback

The revision migration adds unsigned integer `items.version`
with default 1, backfilling existing rows without replacing their IDs or item data.
The existing primary key supports the ID/version condition; no additional revision
index is required. Startup refuses readiness with this migration pending.

Clients must retain returned versions, send `expected_version` for PUT/PATCH, and replace DELETE calls
with `POST /api/v1/items/:id/delete` carrying the precondition in JSON. Coordinate
client/API rollout; old mutation requests will fail validation or route matching.

Stop/drain old writers before enabling revision-enforced writes. Older binaries
can modify rows without checking or advancing revisions even though the additive
schema still accepts them. Do not run old and new writers concurrently, and do not
roll back the application to an unversioned writer while continuing normal writes.
Prefer forward repair. Any rollback needs an explicit maintenance/write-stop and
client-compatibility plan. The migration's down operation drops revision history;
it is an offline schema downgrade, not a safe online application rollback. The
upgrade/down/re-up rehearsal runs only against disposable MySQL, never the dev DB.

## Production logging

Production logging writes timestamped JSON. Review [logging behavior](deployment.md#logging-and-metrics)
when configuring collectors: successful requests use `debug`, error records
use safe diagnostics/fingerprints, and request paths are route templates. No
database migration is required for logging configuration; restart after changing
its environment settings.

Logs distinguish completed and aborted responses. Monitoring can use
`http_requests_aborted_total{method,route}` for interrupted responses; completed
counter/histogram names, label names, units, and buckets follow the documented
metrics contract. Route labels use full templates and `<unmatched>`; dashboards
and alerts must select those values. Aborted responses are excluded from
completed-request counters and duration histograms, even if headers carried 200.
See the [metrics contract](deployment.md#logging-and-metrics) and its transport boundaries.

## Operational endpoint access

Configure [operational exposure flags](configuration.md#operational-endpoint-exposure)
explicitly for the deployment. Production defaults disable documentation,
diagnostics, and metrics. Enabling a group makes it reachable without application
authentication; disabled groups return 404. Liveness/readiness remain public.

For monitoring, configure the reverse proxy/ingress to deny public `/metrics`
access and permit only the monitoring network or authenticated operations
client. Block direct public access to the API port as well; otherwise callers
can bypass ingress restrictions. Then set `METRICS_ENABLED=true` on the API.
Keep `/info` and `/system` disabled unless an equivalent restriction is in place.
Documentation may be deliberately enabled with `DOCS_ENABLED=true`.

These flags control availability, not authentication: an enabled endpoint is
accessible to every client that can reach the listener. CORS and `TRUST_PROXY`
do not restrict operations access. Do not use caller-supplied forwarding headers
as an authorization mechanism. Before release, verify public denial and an
authorized scraper through the real ingress, including direct-port denial.
Local tests establish enablement/disablement only; ingress enforcement remains
deployment-owned.

## HTTP deadlines and shutdown

The [validated duration settings](configuration.md#http-deadlines-and-shutdown-configuration)
default to 5 seconds for receiving headers, 10 seconds for receiving the complete
request, and 10 seconds for producing an API response. Node rejects slow input
with 408; transport errors can occur before Express and need not use the JSON
error envelope. API response expiry returns JSON 408 when headers are unsent;
after headers are sent, it closes the incomplete response. Static files bypass
the API response timer but remain subject to server receive deadlines and shutdown.

Calling `res.end()` does not finish the response deadline while its final write is
still pending. The timer is cleared on response finish or disconnection; an
unfinished response is destroyed at the deadline even after `end()` was called.

On SIGINT/SIGTERM or fatal shutdown, readiness and new request admission are
withdrawn immediately. HTTP closes first, allowing accepted requests and tracked
handler promises to drain for up to 25 seconds. MySQL stays available during that
drain and closes afterward. Responses that already timed out or disconnected do
not imply that their underlying database work finished. Repeated shutdown calls
share the same cleanup; a fatal signal path preserves a failing exit code.

When HTTP drain expires, remaining connections are destroyed, cleanup proceeds,
and exit status is 1. The overall 30-second watchdog forces exit 1 if work or
cleanup still keeps the process alive. Unfinished mutations can have an unknown
outcome: a response timeout or process exit does not promise cancellation or rollback.
Clients must reconcile uncertain writes rather than assume a retry is safe.

Both Compose API services allow 40 seconds before the container supervisor kills
the process. Keep deployment termination grace longer than `SHUTDOWN_TIMEOUT_MS`
when overriding it. The supervisor remains the fallback for a blocked JavaScript
event loop, where application timers cannot run. Apply the same ordering in any
orchestrator or ingress drain policy. No schema migration is required.

## Release and rollback

### Release lifecycle

The `Release image` workflow follows successful push CI on `main`. PRs continue
through `dev`; neither PRs nor pushes to `dev` publish images. Manual dispatch
must run from `main`, selects a full commit SHA already on `main`, and defaults
to a dry run. The latest push CI run for that exact SHA must have succeeded.
An older successful run cannot excuse a newer failed or incomplete run.

1. Check out the selected commit without persisted Git credentials. Build one
   unpublished `linux/amd64` OCI archive using BuildKit, with SPDX SBOM and maximum
   provenance. Additional architectures require their own runtime evidence.
2. Validate the OCI index, runtime configuration, source labels, and both
   attestations. Their manifest references must identify the runtime being tested;
   provenance must identify the selected Git revision and repository. BuildKit
   versions with empty statement subjects are supported through the binding in
   their OCI attestation-manifest annotations. A nonempty subject must match.
3. Load this archive into a containerd image store. Run the existing production
   smoke topology against its immutable local identity, without another build:
   isolated MySQL, explicit compiled migrations, readiness, API operations,
   favicon content/type, non-root runtime, and SIGTERM shutdown. Teardown owns
   only disposable smoke infrastructure; it never accesses the development DB.
4. Scan the original archive's OS and Node packages using the shared critical-only
   policy. Retain lower severities. Missing evidence, scanner failures, invalid
   exceptions, and critical blockers prevent publication.
5. Recheck archive, report, policy, and extracted-attestation hashes and the
   successful smoke record. Only then authenticate and import the original OCI
   archive into the registry, retaining its attestations. No rebuild occurs.
6. Verify the published index digest equals the build/scanned candidate digest.
   Copy commit and application-version tags from that digest and verify each tag.
   Write `release-image.env` only after every publication check passes.

The local Docker image ID/config digest, runtime manifest digest, and release OCI
index digest identify different objects. The verifier checks their relationship;
they are not interchangeable. Deploy the published **index digest**.

The workflow publishes artifacts; it does not deploy a running environment or
apply migrations to a deployment database. Base CI and release verification build
separate candidates. Successful base CI alone cannot approve the release image.

### Registry and permissions

The defaults are GHCR and the lowercase GitHub repository name. Optional repository
variables `CONTAINER_REGISTRY` and `CONTAINER_REPOSITORY` select another compatible
OCI registry. For a separate registry, configure `REGISTRY_USERNAME` and
`REGISTRY_PASSWORD` in the `release` GitHub environment. Its credential needs only
pull/push access to the selected repository, not repository administration.

Create/configure the `release` environment and select any required reviewers
before enabling publication. GitHub evaluates environment branch restrictions
against the workflow ref: `workflow_run` uses the repository default branch
whereas manual runs here use `main`. Allow these trusted
workflow refs in the environment policy and protect both branches; the workflow
separately restricts the **candidate source** to commits on `main`. The workflow requests
`contents: read`, `actions: read`, and job-scoped `packages: write`; it needs no Git
write permission. GHCR uses the job's `GITHUB_TOKEN`. Keep package creation/access
permissions consistent with that repository. Registry login follows verification,
and PR jobs receive no release credentials. Serialize releases to avoid tag races.

Attestations are BuildKit-generated OCI metadata, preserved by digest; this is not
a claim of independently signed GitHub attestations or a particular SLSA level.
The trusted workflow, source restrictions, environment controls, and registry
access are the publication boundary. Do not pass secrets as build arguments:
maximum provenance may record build parameters. Use BuildKit secret mounts if a
future build needs a secret.

Tags are discoverable aliases and may move; digests are deployment identities.
The SHA/version tags can be updated by a later approved publication. There is no
automatic `latest` tag or automatic environment deployment.

### Evidence and retention

Each run retains `release-evidence-<run>-<attempt>` for 90 days, subject to the
repository/organization retention limit. It includes:

- `workflow.json`: source SHA, repository, successful CI run ID, release workflow
  run/attempt, and build digest;
- `smoke.json` and `smoke.log`: successful runtime identity, source and archive
  hash, completion time, and production topology output;
- `candidate.json`: release/runtime/config identities, source, archive/report/
  attestation/policy hashes, scanner image ID and version;
- `sbom.spdx.json` and `provenance.json`: extracted candidate attestations;
- raw JSON/SARIF vulnerabilities, `gate.json`, readable summary, and exception
  policy; failure evidence remains available when verification fails;
- after publication, `publication.json`, publisher image ID, and
  `release-image.env` containing the verified `QUICKAPI_IMAGE=...@sha256:...`.

The OCI archive stays local until approved and is not uploaded as a GitHub
artifact. After publication, its manifests/attestations are in the registry.
Preserve verified release records outside short-lived CI retention when needed
for your rollback horizon, and retain their registry digests against garbage
collection. Do not interpret an expired CI artifact as a deleted registry image.

If publication fails partway through, some tags may already exist. Treat the run
as failed; no verified deployment reference is produced. Inspect retained
evidence before retrying. Rerunning the workflow builds a new candidate; it must
pass verification again and may have a different digest.

### Promotion and rollback

Use the verified `QUICKAPI_IMAGE` reference from the release record in the
deployment platform. Promotion between environments selects that same digest;
it never builds the source again. Verify the reference against the release record
and confirm its attestations and scan/smoke evidence before deployment. This
repository does not currently automate environment promotion.

For rollback, select the previous successful release's verified digest, confirm
it remains available and is compatible with the **current** database schema,
then update the deployment platform's image reference and roll out normally.
Verify readiness, public API behavior, and logs afterward. Keep the replaced
digest in the deployment record for diagnosis.

Application rollback does not reverse migrations or cancel running SQL. Prefer
backward-compatible additive schema changes; a destructive migration may require
a forward repair or a separately rehearsed restore. Never run an automatic
database reset or migration revert as part of image rollback.

### Local verification

Use Node 24, Docker with the containerd image store, Buildx, Compose v2, and Bash.
On Windows, the candidate helper selects Git Bash at its default installation;
set `RELEASE_BASH` to override that executable. Use fresh evidence directories.

```bash
export RELEASE_SHA="$(git rev-parse HEAD)"
export RELEASE_SOURCE=https://github.com/desjjoh/QuickAPI-Express
mkdir -p .release-check/local-candidate
docker buildx build --platform linux/amd64 --provenance=mode=max --sbom=true \
  --label "org.opencontainers.image.revision=$RELEASE_SHA" \
  --label "org.opencontainers.image.source=$RELEASE_SOURCE" \
  --output type=oci,dest=.release-check/local-candidate/image.tar .
node .github/scripts/release-candidate.cjs smoke .release-check/local-candidate/image.tar .release-check/local-evidence
node .github/scripts/release-candidate.cjs scan .release-check/local-candidate/image.tar .release-check/local-evidence
node .github/scripts/release-candidate.cjs verify .release-check/local-candidate/image.tar .release-check/local-evidence
npm run test:release
```

The release helper refuses publication without successful smoke/scan evidence.
Local verification does not establish remote CI success, environment approvals,
or registry authorization. Use the manual workflow's dry run to verify those
GitHub execution boundaries without publication.

Implementation references: [Docker build attestations](https://docs.docker.com/build/metadata/attestations/),
[GitHub workflow-run refs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run),
and [environment branch restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

## Logging and metrics

### Output and severity

Logging uses Pino. Development/test console output follows QuickAPI-NestJS:
local timestamp, PID, padded lowercase severity, optional request ID, and message.
Production writes structured JSON with an ISO-8601 UTC `time`, `levelLabel`,
`pid`, `hostname`, and `msg`. Console output uses the configured local timezone.

Console error records show the standard prefix and message on one line, without
appending diagnostic objects. Production JSON retains the allowlisted error
diagnostics described below, including fixed guidance for `APP_PENDING_MIGRATIONS`.

`LOG_LEVEL` filters output. Completed request logs use `debug` for statuses below
400, `warn` for 4xx, and `error` for 5xx. Consequently `LOG_LEVEL=info` suppresses
successful request logs; use `debug` when those records are needed.

Request messages contain status, a padded method and route, and elapsed
milliseconds to two decimal places. Structured access records also contain
`method`, the full `route` template, `outcome`, `headersSent`, and full-precision
`durationMs`. Completed responses include numeric `status`.
The console route is truncated to 30 characters and padded to 32, matching NestJS.

Routes use server-declared templates such as `/api/v1/items/:id`, never actual
item IDs or query strings. Unknown routes and policy failures before routing use
`<unmatched>`. Methods outside the supported method set use `<other>`. Item
router mounts explicitly register their template prefix with `logRoute`; keep
that declaration aligned when changing mounts. Dynamic mounts must supply their
declared template rather than copying `req.baseUrl`, which contains real values.
Swagger middleware uses a fixed `/docs` route name.

### Request correlation

Request context creates a server-generated ID returned as `X-Request-Id`.
AsyncLocalStorage scopes it to the downstream request, including asynchronous
handler work. Context contains a timestamp, normalized method, and resolved
client IP; it stores no raw URL/path, query, headers, or body. Logs include the
request ID, method, and resolved IP when context is available. Proxy trust still
determines client identity; see [proxy configuration](configuration.md#proxy-and-cors-configuration).

The completion callback captures its request ID explicitly. Concurrent requests
must not inherit each other's identity, and a handler that fails after its HTTP
deadline retains its own correlation while its work settles.

### Errors and sensitive data

Request rejection, unexpected failure, bootstrap failure, process errors, and
shutdown cleanup use stable messages rather than interpolating exceptions or
submitted values. Application-owned lifecycle service names remain in lifecycle
messages. HTTP status/message response contracts remain unchanged.

The `error`, `err`, and `reason` fields use the same allowlisted diagnostics as
NestJS: recognized error type/code, an optional valid upstream status, and a
SHA-256 fingerprint of stack frames. They exclude exception messages, raw stacks,
SQL, parameters, causes, and provider payloads. Unknown thrown values produce
`UnknownError`; hostile diagnostic getters cannot break serialization.

After response headers are sent, the error boundary records safe diagnostics and
delegates a generic error without its stack to Express. Express can then close
the incomplete response without printing the original exception. Late handler
failures use the same serializer and do not send another response.

Pino also removes explicit sensitive fields at the root and one object level
below it: request/response objects, body/query/params/headers/cookies, credentials,
tokens, replay/payload fields, and raw stack/SQL fields. See
[logger configuration](../src/config/logger.config.ts) for the exact names.
This is defense in depth, not arbitrary text sanitization: never interpolate
untrusted values into messages or log new provider payload structures directly.
Use fixed messages and the diagnostics serializer at new error call sites.
Resolved IP addresses remain intentional operational data; apply deployment log
access and retention policies accordingly.

### Completion and disconnect lifecycle

Logs and metrics share one request-outcome observation. The first subscriber
starts a monotonic elapsed-time clock; subsequent subscribers share its listeners.
The observer settles on request `aborted`, response `finish`, or response `close`.
`res.writableFinished` distinguishes a completed response from an interrupted one.
It removes all three of its listeners before notifying subscribers, releases
subscriber callbacks, and ignores later events. It adds no listeners to sockets.
Observation state is held in a WeakMap keyed by request, with no persistent
client/URL registry.

Completed access messages retain the NestJS layout. Interrupted responses use
an `ABORTED` prefix and warning severity (error severity if headers carried 5xx).
They include `status` only when headers were actually sent. For example, an
aborted partial 200 response has `outcome=aborted`, `headersSent=true`, and
`status=200`; it is never counted as a completed 200. A disconnect before headers
has no status. No synthetic 499 or other HTTP status is invented.

A JSON 408 that finishes normally is a completed response. A deadline that
destroys an already-started response is aborted. Abort describes the transport
outcome; it does not identify whether the client, server deadline, shutdown, or
network caused the interruption. Logs and metrics stop timing at transport
completion/disconnection, independently of handler promises or database work.

### Metrics contract

| Metric                        | Labels                      | Meaning                                                                         |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `http_requests_total`         | `method`, `route`, `status` | Completed HTTP responses, including 4xx/5xx.                                    |
| `http_request_duration_ms`    | `method`, `route`, `status` | Completed response duration in milliseconds; existing buckets remain unchanged. |
| `http_requests_aborted_total` | `method`, `route`           | Requests whose response did not finish before disconnection.                    |

Completed metrics use the names, labels, units, and histogram buckets defined above.
Aborted requests increment only `http_requests_aborted_total` and do not enter the
completed counter or histogram. Each log and metric observer receives the same
outcome, route, method, and elapsed time.

Route labels use full templates such as `/api/v1/items/:id`; unmatched requests
use `<unmatched>`. Dashboards and alerts must select those values. Collectors with
legacy `/:id` or `unknown_route` series can retain them until monitoring retention
expires, but current requests use the full-template labels.
Known methods retain their names, with unsupported methods grouped as `<other>`.
Request IDs, IPs, query strings, item IDs, and concrete dynamic mount values are
never metric labels. Series growth is bounded by server-declared route templates,
method buckets, and HTTP statuses, rather than incoming distinct paths/clients.
