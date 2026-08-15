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

## Current Foundation

- `apps/web`: React/Vite application shell and API health indicator.
- `apps/api`: NestJS bootstrap, validated environment, constrained CORS, and `GET /health`.
- PostgreSQL development service with persistent storage and a healthcheck.
- Prisma ORM with the PostgreSQL driver adapter, Nest lifecycle management, and a baseline migration.
- pnpm workspaces, Turborepo, strict TypeScript, ESLint, Prettier, Vitest, and CI.

No domain schema, domain module, authentication, tenant logic, Redis, worker, WebSocket, or AI integration exists in Phase 1.

## Boundary Rules

- Controllers translate transport concerns and delegate; they do not own business rules.
- Domain/application logic must not depend directly on HTTP, a specific AI SDK, or browser state.
- PostgreSQL remains authoritative. Redis is optional infrastructure, never durable truth.
- A future request's workspace identifier is untrusted until active membership and authorization are verified.
- Every future tenant query, cache key, WebSocket room, job payload, and AI context must carry and enforce the workspace boundary.
- Activity feed and security audit log remain distinct concepts.

## Deferred Decisions

Tailwind, the component system, Redis, BullMQ, Socket.IO, object storage, observability vendors, and deployment targets will be selected when their implementing phase begins. Prisma ORM is the selected PostgreSQL persistence layer; domain models remain deferred to their implementing phases. Deferring the remaining selections avoids unused dependencies without removing them from the roadmap.
