# AI-Powered Multi-Tenant SaaS Project Management Platform

A production-minded full-stack foundation for a collaborative project management SaaS with planned tenant isolation, role-based authorization, real-time collaboration, analytics, and human-reviewed AI workflows.

## Status

**Phase 2 — Authentication is in progress.** The secure account and opaque-session core is implemented. Email verification, password recovery, and the remaining Phase 2 hardening are still pending. Workspaces, projects, tasks, Kanban, collaboration, real-time features, and AI remain planned. See the [product roadmap](docs/roadmap/product-roadmap.md) for approved future scope.

### Implemented

- pnpm/Turborepo monorepo
- React, Vite, and strict TypeScript web shell
- NestJS and strict TypeScript API
- validated backend environment configuration
- constrained development CORS configuration
- safe `GET /health` response
- PostgreSQL user and session schema with deployable Prisma migration
- account registration and login with boundary validation and Argon2id password hashing
- opaque, hashed, expiring, rotating, revocable cookie sessions
- authenticated profile, current-session logout, and all-session logout endpoints
- authentication rate limits and API-level lifecycle tests
- PostgreSQL Docker Compose service with persistent volume and healthcheck
- ESLint, Prettier, type checking, Vitest smoke tests, and production builds
- GitHub Actions quality workflow

### Planned

Email verification and password recovery, workspace-scoped multi-tenancy, capability-based RBAC, project/task/Kanban workflows, collaboration, notifications, real-time updates, analytics, search, audit logs, AI planning and reporting, security/testing/performance hardening, production infrastructure, and UX polish are documented but intentionally not implemented yet.

## Technology

- Node.js 22+
- pnpm 10 and Turborepo
- React 19, Vite, TypeScript
- NestJS, Zod boundary validation, Prisma ORM, Argon2id
- PostgreSQL 17 for local development
- Vitest, Testing Library, Supertest
- ESLint and Prettier

The long-term architecture remains a TypeScript modular monolith with PostgreSQL as the source of truth and Workspace as the tenant boundary. Redis, background workers, WebSockets, and AI adapters will be added only when the relevant feature needs them.

## Repository Structure

```text
apps/
  api/                 NestJS modular API and Prisma migrations
  web/                 React/Vite web foundation
docs/
  architecture/        architecture direction and decisions
  roadmap/             complete phased product roadmap
.github/workflows/     CI quality checks
docker-compose.yml     local PostgreSQL service
```

## Prerequisites

- Node.js 22 or newer
- pnpm 10 (`corepack enable` can make the pinned version available)
- Docker with Docker Compose for local PostgreSQL

## Setup

```bash
git clone https://github.com/void-fatima/ai-saas-project-management-platform.git
cd ai-saas-project-management-platform
corepack enable
pnpm install
```

Copy `.env.example` to `.env`, then replace the example PostgreSQL password with a local value. The `POSTGRES_*` values and credentials embedded in `DATABASE_URL` must agree.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Linux/macOS:

```bash
cp .env.example .env
```

Never commit `.env`.

## Run Locally

Start PostgreSQL and wait until it is healthy:

```bash
docker compose up -d postgres
docker compose ps
```

Start both applications from the repository root:

```bash
pnpm dev
```

The web app runs at `http://localhost:5173`, the API at `http://localhost:3000`, and the public health endpoint at `http://localhost:3000/health`.

To run one application only:

```bash
pnpm --filter @platform/api dev
pnpm --filter @platform/web dev
```

The API validates `NODE_ENV`, `API_PORT`, `WEB_ORIGIN`, `DATABASE_URL`, and session policy configuration during startup. PostgreSQL connectivity is intentionally not exposed by the public health response.

Apply development migrations after PostgreSQL is healthy:

```bash
pnpm --filter @platform/api db:migrate
```

Production-style environments should apply committed migrations non-interactively:

```bash
pnpm --filter @platform/api db:migrate:deploy
```

## Authentication API

All authentication responses are marked `Cache-Control: no-store`. The session credential is delivered only through an HttpOnly, SameSite=Strict cookie; the database stores only its SHA-256 hash.

| Method | Path               | Purpose                                 |
| ------ | ------------------ | --------------------------------------- |
| `POST` | `/auth/register`   | Create an account and session           |
| `POST` | `/auth/login`      | Verify credentials and create a session |
| `GET`  | `/auth/me`         | Return the authenticated user           |
| `POST` | `/auth/logout`     | Revoke the current session              |
| `POST` | `/auth/logout-all` | Revoke every session for the user       |

Registration accepts `name`, `email`, and `password`. Passwords must be 12–128 characters and contain at least one letter and one number. Browser clients must send requests with credentials enabled.

## Quality Commands

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI runs installation with a frozen lockfile followed by format, lint, typecheck, test, and build checks. Deployment is intentionally outside the current phase.

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Full product roadmap](docs/roadmap/product-roadmap.md)
- [Coding-agent guidance](AGENTS.md)
