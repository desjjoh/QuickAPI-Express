# Deployment and operations

[Documentation index](../README.md#documentation)

## Proxy and browser access

`TRUST_PROXY` now defaults to empty (no proxy trust), replacing the old hardcoded
one-hop trust. Deployments behind an ingress must explicitly configure its actual
IP addresses/CIDRs before relying on forwarded client addresses, protocol, or host.
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
The other [CORS settings](development.md#proxy-and-cors-configuration) control
methods, request/response headers, credentials, and preflight caching. Caches
must honor the emitted `Vary` headers, including Origin and the preflight request
method/header fields. CORS is a browser response-access policy, not authentication
or authorization for this public item API.

Before release, verify real ingress requests and browser preflights, the logged
client IP, and that direct/untrusted forwarding cannot change the rate-limit
identity. Automated loopback/allowlist tests do not establish the real network
trust boundary. No schema migration is required for this HTTP policy change.

## Liveness, readiness, and operations

Rate limits are enforced independently by each API process. Configure bounded
client capacity and account for 503 responses when new identities cannot be
tracked. A cross-replica quota needs separate gateway/shared enforcement; this
milestone adds no Redis dependency. See the [rate limiting lifecycle](rate-limiting.md).

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
[database lifecycle](database-lifecycle.md) for detection timing, connection cleanup,
pool exhaustion, startup failure, and recovery limits.

Additional implemented endpoints are `/info`, `/system`, `/metrics`, `/docs`, `/docs-json`, and
`/redoc`.

## HTTP deadlines and shutdown

The [validated duration settings](development.md#http-deadlines-and-shutdown-configuration)
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

## Production image and smoke validation

`Dockerfile` uses three stages: a full locked install compiles TypeScript; a second locked install
retains production dependencies only; and the final Node 24.11.1 Alpine image receives `dist`, package
metadata, and production `node_modules`. The runtime includes `curl`, exposes port 3000, runs as the
non-root `node` user, and starts with `npm run start:compiled`.

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
