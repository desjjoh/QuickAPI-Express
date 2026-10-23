# Deployment and operations

[Documentation index](../README.md#documentation)

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
