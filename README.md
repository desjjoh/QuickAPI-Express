# 🧩 QuickAPI-Express

A modular, production-grade Express.js API template designed for rapid service creation and deployment.  
Implements consistent architecture patterns from the **QuickAPI family** — including FastAPI, NestJS, and others — emphasizing scalability, observability, and clean shutdown behavior.

---

## 🚀 Features

- **TypeScript-first architecture** with strict linting & type safety
- **Prisma ORM (SQLite)** for lightweight, zero-config persistence
- **Zod validation** for schema-driven request validation
- **OpenAPI (Swagger)** auto-generation using `zod-to-openapi`
- **Pino logging** for structured, contextual logs
- **Centralized error handling** with consistent response format
- **Graceful shutdown** via `SystemLifecycle` utility
- **Security middleware**: Helmet, CORS, Compression, Rate Limiting
- **Dockerized build** with multi-stage image and healthchecks
- **Fully documented and modular folder structure**

---

## 🧱 Folder Structure

```bash
src/
 ├── core/
 │    └── middleware/
 │         ├── error-handler.ts      # Centralized error handling
 │         └── validate.ts           # Request validation wrapper
 │
 ├── routes/
 │    ├── health.ts                  # Health & readiness endpoints
 │    └── users.ts                   # User CRUD endpoints
 │
 ├── schemas/
 │    ├── id.schema.ts               # Generic ID schema
 │    ├── system.schema.ts           # Health schemas
 │    └── user.schema.ts             # User validation & DTOs
 │
 ├── services/
 │    ├── openapi/                   # Swagger + Zod integration
 │    ├── env-validation.ts          # Zod environment validation
 │    ├── prisma.ts                  # Prisma client setup
 │    ├── pino.ts                    # Logger configuration
 │    ├── swagger.ts                 # OpenAPI setup entry
 │    └── index.ts                   # Service exports
 │
 ├── system/
 │    └── lifecycle.ts               # Graceful shutdown & signal handling
 │
 ├── utils/
 │    └── http-errors.ts             # Typed HTTP error classes
 │
 └── app.ts                          # Express app factory
 └── index.ts                        # Application entrypoint
```

---

## ⚙️ Environment Variables (`.env`)

```bash
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
DATABASE_URL="file:./dev.db"
```

---

## 🐳 Docker Deployment

### Build and run locally

```bash
docker compose up --build
```

### Healthcheck

The service exposes a readiness probe at:

```bash
GET /health/ready
→ 200 OK
```

---

## 📘 API Documentation

The OpenAPI specification is auto-generated from Zod schemas.  
Swagger UI is available at:

```bash
http://localhost:3000/docs
```

---

## 🧩 Lifecycle Management

The `SystemLifecycle` utility manages process signals (`SIGINT`, `SIGTERM`) to:

- Gracefully close the HTTP server
- Disconnect from Prisma ORM
- Log total uptime and shutdown duration

Example usage:

```ts
SystemLifecycle.register(start, [
  { name: 'server', stop: async () => SystemLifecycle.closeServer(server) },
  { name: 'prisma', stop: async () => prisma.$disconnect() },
]);
```

---

## 🧠 Development Scripts

| Command                   | Description                            |
| ------------------------- | -------------------------------------- |
| `npm run dev`             | Start with hot reload (TS)             |
| `npm run build`           | Compile TypeScript and rewrite aliases |
| `npm start`               | Run compiled JS                        |
| `npm run prisma:generate` | Generate Prisma client                 |
| `npm run docker:up`       | Build and run via Docker Compose       |

---

## 🧾 License

Licensed under the [MIT License](./LICENSE).

---

**QuickAPI-Express** — a part of the **QuickAPI** family of backend templates designed by John Desjardins.
