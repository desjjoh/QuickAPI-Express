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
2. Follow [local configuration](docs/development.md#configuration): the development Compose database uses host port 3307, database `quickapi`, and user/password `app`. The example file needs these overrides for this topology.
3. Start MySQL and wait for it to become healthy, then apply migrations and start the API:

   ```bash
   docker compose up -d mysql
   npm run migration:run
   npm run dev
   ```

The local API is at `http://localhost:3000`. Swagger is served at `/docs`, OpenAPI JSON at `/docs-json`, and ReDoc at `/redoc`.

## Documentation

See [Database readiness and recovery](docs/database-lifecycle.md) for startup migration checks, runtime probes, and outage/shutdown behavior.

| Guide                                           | Contents                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| [Development](docs/development.md)              | Setup, configuration, migrations, commands, and readability conventions |
| [Architecture](docs/architecture.md)            | Layer boundaries, middleware ordering, startup, and shutdown            |
| [API contracts](docs/api-contracts.md)          | Item routes, validation, pagination, and errors                         |
| [Testing](test/TESTING.md)                      | Test categories, database safety, PowerShell commands, coverage, and CI |
| [Deployment and operations](docs/deployment.md) | Production image, operational endpoints, and container smoke validation |
| [Technical backlog](docs/backlog.md)            | Verified gaps and follow-up work                                        |

Configuration is defined by [.env.example](.env.example) and [environment validation](src/config/env.config.ts). Commands are defined in [package.json](package.json).

## API overview

| Resource                           | Route              |
| ---------------------------------- | ------------------ |
| Items                              | `/api/v1/items`    |
| Process liveness                   | `/health`          |
| Traffic readiness                  | `/ready`           |
| Application and system information | `/info`, `/system` |
| Prometheus metrics                 | `/metrics`         |

See [API contracts](docs/api-contracts.md) for implemented behavior and [deployment](docs/deployment.md) for operational access. The item API currently has no authentication or authorization layer.

## Quality checks

```bash
npm run check
npm run test:unit:coverage
```

`check` verifies formatting, lint, types, unit tests, and build without requiring MySQL. Read [Testing](test/TESTING.md) before running database-backed tests. CI separately checks integration, E2E, migration drift, and production topology; a green run does not establish readiness for every deployment environment.

## License

[MIT](LICENSE).
