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
