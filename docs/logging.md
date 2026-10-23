# Logging and metrics

[Documentation index](../README.md#documentation)

## Output and severity

Logging uses Pino. Development/test console output follows QuickAPI-NestJS:
local timestamp, PID, padded lowercase severity, optional request ID, and message.
Production writes structured JSON with an ISO-8601 UTC `time`, `levelLabel`,
`pid`, `hostname`, and `msg`. Production timestamps are an explicit improvement
over the current NestJS configuration; console styling remains aligned.

Console error records include an indented line containing the already-sanitized
diagnostics, so development failures retain useful error types/codes/fingerprints.
`APP_PENDING_MIGRATIONS` also includes fixed migration guidance. These lines never
print raw exception messages or stacks. This diagnostic detail extends the shared
NestJS prefix/layout without weakening the privacy rules below.

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

## Request correlation

Request context creates a server-generated ID returned as `X-Request-Id`.
AsyncLocalStorage scopes it to the downstream request, including asynchronous
handler work. Context contains a timestamp, normalized method, and resolved
client IP; it stores no raw URL/path, query, headers, or body. Logs include the
request ID, method, and resolved IP when context is available. Proxy trust still
determines client identity; see [proxy configuration](development.md#proxy-and-cors-configuration).

The completion callback captures its request ID explicitly. Concurrent requests
must not inherit each other's identity, and a handler that fails after its HTTP
deadline retains its own correlation while its work settles.

## Errors and sensitive data

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

## Completion and disconnect lifecycle

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

## Metrics contract

| Metric                        | Labels                      | Meaning                                                                         |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `http_requests_total`         | `method`, `route`, `status` | Completed HTTP responses, including 4xx/5xx.                                    |
| `http_request_duration_ms`    | `method`, `route`, `status` | Completed response duration in milliseconds; existing buckets remain unchanged. |
| `http_requests_aborted_total` | `method`, `route`           | Requests whose response did not finish before disconnection.                    |

Completed metric names, label names, units, and histogram buckets are preserved.
Aborted requests increment only the new counter and do not enter the completed
counter or histogram. Each log and metric observer receives the same outcome,
route, method, and elapsed time.

Route label **values change** from local paths such as `/:id` to full templates
such as `/api/v1/items/:id`. The old `unknown_route` value becomes `<unmatched>`.
Update dashboards/alerts that select these values. Old series remain in the
monitoring backend until its retention expires; new requests use the new labels.
Known methods retain their names, with unsupported methods grouped as `<other>`.
Request IDs, IPs, query strings, item IDs, and concrete dynamic mount values are
never metric labels. Series growth is bounded by server-declared route templates,
method buckets, and HTTP statuses, rather than incoming distinct paths/clients.

## Verification and boundaries

Unit tests capture actual JSON/console output, level filtering, UTC timestamps,
redaction, allowlisted diagnostics, stable fingerprints, and hostile getters.
Integration tests cover full item and dynamic mount templates, secret-containing
URLs, normal/429/500 responses, overlapping request contexts, late failures after
408, and sanitized Express delegation after headers were sent. Lifecycle tests
exercise the registered exception/rejection handlers without coercing failures.
Outcome tests cover competing terminal events, listener cleanup, aborted uploads,
disconnects before/after headers, partial-response deadlines, completed 408/500,
25 requests on one keep-alive connection, and bounded series across many item IDs
and unmatched paths. Distinct mount templates remain distinct metric series.

Static files/favicon and shutdown admission precede application telemetry. Requests
rejected there, or by Node's HTTP parser before Express dispatch, are outside
these Express logs and metrics. A completed response does not prove client
receipt or cancellation of database work. No new environment settings or database
migrations are required for either logging/metrics pass.
