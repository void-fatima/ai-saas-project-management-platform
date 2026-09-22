# Architecture Overview

## Direction

The platform is an end-to-end TypeScript modular monolith. The browser runs a React application, which communicates with a NestJS REST API. PostgreSQL is the system of record. Workspace is the tenant boundary; membership and permissions are resolved server-side for each scoped operation.

```text
Browser -> React/Vite -> NestJS REST API -> application/domain modules -> PostgreSQL
                             |
                             +-> Authenticated SSE refresh hints (single process)
                             +-> Redis/BullMQ worker (when background jobs exist)
                             +-> AI provider abstraction (opt-in structured assistance)
```

Production routing will eventually use Nginx or an equivalent managed edge. Deployable components will use secure Docker images. Logs, errors, metrics, and traces will be introduced proportionally as operational needs become real.

## Current Implementation

- `apps/web`: React/Vite application shell and API health indicator.
- `apps/api`: NestJS modular API, validated environment, constrained CORS, rate limiting, and `GET /health`.
- PostgreSQL development service with persistent storage and a healthcheck.
- Prisma ORM with the PostgreSQL driver adapter, Nest lifecycle management, and committed migrations for the baseline, users, and sessions.
- Authentication module with Argon2id credentials and opaque secure-cookie sessions.
- pnpm workspaces, Turborepo, strict TypeScript, ESLint, Prettier, Vitest, and CI.

Workspace creation, membership, invitations and minimal RBAC are implemented through a [transactional tenant boundary](workspace-tenancy.md). Redis, workers and WebSockets remain deferred. Email verification and password recovery use hashed, expiring, atomically consumed tokens and a replaceable mail boundary, also reused for workspace invitations. Local delivery is development-only; a production adapter remains deployment work. Separate liveness and bounded database readiness endpoints support operational checks.

### Authentication boundaries

- HTTP controllers validate transport input and delegate lifecycle rules to `AuthService`.
- `AuthRepository` keeps application logic independent of Prisma; `PrismaAuthRepository` is the PostgreSQL adapter.
- Passwords use Argon2id and are never selected for public API responses.
- Session credentials contain 256 bits of randomness. Only a SHA-256 token hash is persisted.
- Sessions expire, rotate, support individual/all-device revocation, and are capped at ten active sessions per user.
- Authentication endpoints return non-cacheable responses and use HttpOnly, SameSite=Strict cookies.

## Boundary Rules

Projects, Tasks, one-level subtasks and Kanban now use the same workspace lock and authorization boundary. Their [resource contract](projects-tasks.md) defines the role extension, composite tenant constraints, current-member assignments, archive/delete behavior, bounded lists and versioned ordering. No new dependency, service or realtime infrastructure was introduced.

The [collaboration contract](collaboration-realtime.md) adds comments, activity and notifications in the same PostgreSQL transactions. A post-commit in-process signal feeds authenticated SSE streams; workspace locks serialize membership removal with protected delivery. Batched session/membership validation avoids per-client queries. REST and persisted state repair missed hints on reconnect. Multiple API replicas require shared pub/sub before deployment; no Redis, worker or WebSocket dependency was added to this single-process slice.

- Controllers translate transport concerns and delegate; they do not own business rules.
- Domain/application logic must not depend directly on HTTP, a specific AI SDK, or browser state.
- PostgreSQL remains authoritative. Redis is optional infrastructure, never durable truth.
- A future request's workspace identifier is untrusted until active membership and authorization are verified.
- Every future tenant query, cache key, WebSocket room, job payload, and AI context must carry and enforce the workspace boundary.
- Activity feed and security audit log remain distinct concepts.

The [dashboard/search contract](dashboard-search.md) defines persisted workspace summaries and bounded PostgreSQL text search across projects, tasks and subtasks. A discovery module reuses `WorkspaceAccess` and scoped transactions, fixed aggregates and parameterized ranked search. The web overview and existing command palette read these endpoints with cancellation, scope isolation and SSE refresh hints. No AI, cache, external search service or analytics platform is introduced.

The [AI assistance contract](ai-assistant.md) adds an opt-in provider boundary, project summaries, task action plans and editable subtask proposals. PostgreSQL holds bounded request reservations and minimal usage/apply metadata. Network calls run outside workspace locks; delivery and atomic apply recheck membership and resource scope. Apply reuses the existing task domain service and activity transaction.

## Deferred Decisions

Tailwind, the component system, Redis, BullMQ, Socket.IO, object storage, observability vendors, and deployment targets will be selected when their implementing phase begins. Prisma ORM is the selected PostgreSQL persistence layer; domain models remain deferred to their implementing phases. Deferring the remaining selections avoids unused dependencies without removing them from the roadmap.
