# Architecture Overview

## Direction

The platform is an end-to-end TypeScript modular monolith. The browser runs a React application, which communicates with a NestJS REST API. PostgreSQL is the system of record. Workspace will become the tenant boundary when the workspace phase begins.

```text
Browser -> React/Vite -> NestJS REST API -> application/domain modules -> PostgreSQL
                             |
                             +-> WebSockets (when real-time is justified)
                             +-> Redis/BullMQ worker (when background jobs exist)
                             +-> AI provider abstraction (when AI features begin)
```

Production routing will eventually use Nginx or an equivalent managed edge. Deployable components will use secure Docker images. Logs, errors, metrics, and traces will be introduced proportionally as operational needs become real.

## Current Implementation

- `apps/web`: React/Vite application shell and API health indicator.
- `apps/api`: NestJS modular API, validated environment, constrained CORS, rate limiting, and `GET /health`.
- PostgreSQL development service with persistent storage and a healthcheck.
- Prisma persistence adapter and committed PostgreSQL migrations for users and sessions.
- Authentication module with Argon2id credentials and opaque secure-cookie sessions.
- pnpm workspaces, Turborepo, strict TypeScript, ESLint, Prettier, Vitest, and CI.

Workspace tenant logic, Redis, workers, WebSockets, and AI integrations do not exist yet. Email verification and password recovery remain pending within Phase 2.

### Authentication boundaries

- HTTP controllers validate transport input and delegate lifecycle rules to `AuthService`.
- `AuthRepository` keeps application logic independent of Prisma; `PrismaAuthRepository` is the PostgreSQL adapter.
- Passwords use Argon2id and are never selected for public API responses.
- Session credentials contain 256 bits of randomness. Only a SHA-256 token hash is persisted.
- Sessions expire, rotate, support individual/all-device revocation, and are capped at ten active sessions per user.
- Authentication endpoints return non-cacheable responses and use HttpOnly, SameSite=Strict cookies.

## Boundary Rules

- Controllers translate transport concerns and delegate; they do not own business rules.
- Domain/application logic must not depend directly on HTTP, a specific AI SDK, or browser state.
- PostgreSQL remains authoritative. Redis is optional infrastructure, never durable truth.
- A future request's workspace identifier is untrusted until active membership and authorization are verified.
- Every future tenant query, cache key, WebSocket room, job payload, and AI context must carry and enforce the workspace boundary.
- Activity feed and security audit log remain distinct concepts.

## Deferred Decisions

Prisma, Tailwind, the component system, Redis, BullMQ, Socket.IO, object storage, observability vendors, and deployment targets will be selected when their implementing phase begins. Deferring installation avoids unused dependencies without removing them from the roadmap.
