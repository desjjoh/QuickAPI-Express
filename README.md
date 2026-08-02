# QuickAPI-Express

A modular, production-grade Express.js API template designed for rapid service creation and deployment.  
Implements consistent architecture patterns from the **QuickAPI family** — including FastAPI, NestJS, and others — emphasizing scalability, observability, strict validation, and graceful shutdown behavior.

---

## Features

- **TypeScript-first architecture** with strict linting & type safety
- **TypeORM (MySQL)** as the primary database layer
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
 ├── common/                          # Cross-cutting application concerns
 │   ├── exceptions/                  # Typed HTTP errors
 │   ├── handlers/                    # Lifecycle and process-level handlers
 │   ├── helpers/                     # Small reusable utilities
 │   ├── middleware/                  # Validation, observability, and security middleware
 │   ├── routes/                      # Shared fallback routes
 │   └── store/                       # Request-scoped state
 ├── config/                          # Environment, logging, OpenAPI, HTTP, and database config
 ├── library/                         # Shared API contracts
 │   ├── models/                      # Reusable Zod schemas and TypeScript models
 │   └── types/                       # Global/shared TypeScript declarations
 ├── server/                          # Feature modules
 │   ├── api/                         # Versioned API modules and routes
 │   │   ├── v1/items/                # Item controllers, docs, and models
 │   │   └── v2/                      # V2 API routes
 │   ├── domain/                      # Database and data manipulation layer
 │   │   ├── entities/                # TypeORM entities
 │   │   └── repositories/            # Database repositories
 │   └── system/                      # Root, health, readiness, and info endpoints
 │       ├── controllers/
 │       ├── docs/
 │       └── models/
 └── index.ts                         # Application bootstrap entry point
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
 ├── setup.ts                         # Test environment initialization
 └── server.test.ts                   # HTTP server lifecycle test
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

Definitions are generated from Zod schemas with path registration in the feature modules under
`src/server/api` and `src/server/system`.

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
| `npm run build`        | Compile TypeScript and rewrite path aliases                 |
| `npm run typecheck`    | Type-check the project without emitting build output        |
| `npm run clean`        | Remove `dist` and rebuild the project                       |
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
