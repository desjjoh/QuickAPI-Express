# QuickAPI-Express

A modular, production-grade Express.js API template designed for rapid service creation and deployment.  
Implements consistent architecture patterns from the **QuickAPI family** — including FastAPI, NestJS, and others — emphasizing scalability, observability, strict validation, and graceful shutdown behavior.

---

## Features

- **TypeScript-first architecture** with strict linting & type safety
- **TypeORM (MySQL)** as the primary database layer
- **SQLite support** still available via TypeORM configuration
- **Vitest** for unit, integration, and E2E testing
- **Zod validation** for schema-driven request & response validation
- **OpenAPI (Swagger)** auto-generation using `zod-to-openapi`
- **Pino logging** with consistent colorized formatting
- **Centralized error handling** with typed HTTP exceptions
- **Graceful shutdown** via the SystemLifecycle utility
- **Security middleware**: Helmet, CORS, compression, rate limiting
- **Docker Compose MySQL database** included for local development
- **Modular folder structure** optimized for long-term maintainability
- **Built-in pagination, sorting, and filtering utilities** through shared query schemas

---

## Folder Structure

```bash
src/
 ├── config/                          # Environment, logging, OpenAPI, database config
 ├── controllers/                     # Route-level orchestration (thin controllers)
 ├── docs/                            # OpenAPI path + schema registration
 ├── entities/                        # TypeORM entities (database schema)
 ├── exceptions/                      # Typed HTTP errors
 ├── handlers/                        # Process-level handlers
 ├── helpers/                         # Small utilities shared across modules
 ├── mappers/                         # Entity → DTO transformers
 ├── middleware/                      # Express middleware (validation, errors, security)
 ├── models/                          # Zod schemas + TypeScript models
 ├── repositories/                    # TypeORM repositories (DB access layer)
 ├── routes/                          # Express Router modules
 ├── services/                        # Business logic layer
 ├── store/                           # Context and scoped shared state
 ├── types/                           # Global/shared TypeScript types
 └── index.ts                         # Application entrypoint
```

---

## Testing Structure

Vitest is fully configured with support for:

- ESM
- TypeScript
- Alias resolution
- Isolated environment setup

```bash
test/
 ├── unit/            # Pure logic tests (services, helpers)
 ├── integration/     # DB + repository tests
 └── e2e/             # Full HTTP API tests through the real server
```

---

## Environment Variables (`.env`)

```bash
NODE_ENV=development

PORT=8080
LOG_LEVEL=debug

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root
DB_DATABASE=dev
```

Each variable is validated using Zod with strict SemVer enforcement for `APP_VERSION`.

---

## Docker & Database Setup

A **Docker Compose MySQL service** is included for local development:

```bash
docker compose up --build
```

The service runs with:

- MySQL 8.x
- Persisted volume
- Auto-created development database

Your API automatically connects through TypeORM.

---

## API Documentation

OpenAPI documentation is always in sync with Zod schemas.  
Swagger UI is available at:

```bash
http://localhost:8080/docs
```

Definitions are generated from Zod with path registration in `/src/docs`.

---

## Lifecycle Management

The SystemLifecycle utility handles:

- SIGINT / SIGTERM handling
- Ordered service shutdown
- Logging shutdown metrics
- HTTP server closure
- TypeORM connection teardown

This ensures stable behavior inside containers and orchestrators.

---

## Development Scripts

| Script                 | Description                                                 |
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev`          | Start development server with hot reload (TSX + watch mode) |
| `npm run dev:debug`    | Start development server in Node.js inspector/debug mode    |
| `npm run build`        | Compile TypeScript and rewrite path aliases                 |
| `npm run clean`        | Remove `dist` directory                                     |
| `npm run rebuild`      | Clean, build, and start application                         |
| `npm run start`        | Start compiled server in production mode                    |
| `npm run test`         | Run Vitest in interactive mode                              |
| `npm run coverage`     | Run full test suite with coverage reporting                 |
| `npm run lint`         | Run ESLint on entire project                                |
| `npm run lint:fix`     | Automatically fix linting issues                            |
| `npm run format`       | Check formatting using Prettier                             |
| `npm run format:fix`   | Format all files using Prettier                             |
| `npm run docker:build` | Build Docker image                                          |
| `npm run docker:run`   | Run built Docker container locally                          |
| `npm run docker:up`    | Start local stack via Docker Compose (API + MySQL)          |

---

## License

MIT License — free for personal and commercial use.

---

QuickAPI-Express — part of the **QuickAPI** template ecosystem by **John Desjardins**.
