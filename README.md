# QuickAPI-Express

A TypeScript and Express 5 API with MySQL persistence, explicit migrations, structured logging, and production container checks.

## What's included

- Item CRUD with Zod validation, pagination, filtering, and response DTOs.
- TypeORM repositories and explicit MySQL schema migrations.
- Request policies, centralized errors, request correlation, and Prometheus metrics.
- Liveness/readiness endpoints, OpenAPI documentation, disposable database tests, and a production container smoke test.

## Getting started

Use Node.js 24 (`>=24 <25`), npm 11.4.2, Docker Engine, and Docker Compose v2.

1. Run `npm ci`, then copy [.env.example](.env.example) to a gitignored `.env`.
2. Review [Configuration](docs/configuration.md). The example connects to persistent
   development MySQL at `127.0.0.1:3309`, schema `quickapi`, using local-only credentials.
3. Run `npm run dev:db` to start MySQL and apply migrations, then `npm run dev`.

The default API is `http://localhost:3000`. Documentation defaults to enabled in
development/test and disabled in production. When enabled, Swagger is at `/docs`,
OpenAPI JSON at `/docs-json`, and ReDoc at `/redoc`. See [Setup](docs/setup.md)
for native/container workflows and [Security](docs/security.md) for exposure limits.

## Documentation

| Guide                                  | Contents                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| [Setup](docs/setup.md)                 | Installation, local MySQL, development commands, and readability conventions    |
| [Architecture](docs/architecture.md)   | Layer boundaries, middleware order, transactions, startup, and shutdown         |
| [Configuration](docs/configuration.md) | Environment loading, validation, HTTP policy, and environment targets           |
| [Testing](docs/testing.md)             | Test layers, disposable database safety, coverage, and CI                       |
| [Security](docs/security.md)           | Public API boundaries, proxy/CORS trust, operational access, and security gates |
| [Deployment](docs/deployment.md)       | Runtime requirements, migration ordering, access, and rollback constraints      |
| [Backlog](docs/backlog.md)             | Known limitations and deferred work                                             |

Configuration is defined by [.env.example](.env.example) and [environment validation](src/config/env.config.ts). Commands are defined in [package.json](package.json).

## API overview

| Resource                           | Route              |
| ---------------------------------- | ------------------ |
| Items                              | `/api/v1/items`    |
| Process liveness                   | `/health`          |
| Traffic readiness                  | `/ready`           |
| Application and system information | `/info`, `/system` |
| Prometheus metrics                 | `/metrics`         |

See [API contracts](docs/architecture.md#api-contracts) for implemented behavior and [deployment](docs/deployment.md) for operational access. The item API currently has no authentication or authorization layer.

## Quality checks

```bash
npm run check
npm run test:unit:coverage
```

`check` verifies formatting, lint, types, unit tests, and build without requiring MySQL. Read [Testing](docs/testing.md) before running database-backed tests. CI separately checks integration, E2E, migration drift, and production topology; a green run does not establish readiness for every deployment environment.

## License

[MIT](LICENSE).
