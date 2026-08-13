# AI-Powered Multi-Tenant SaaS Project Management Platform

A production-minded full-stack foundation for a collaborative project management SaaS with planned tenant isolation, role-based authorization, real-time collaboration, analytics, and human-reviewed AI workflows.

## Status

**Phase 1 — Foundation is implemented.** This repository does not yet implement authentication, workspaces, projects, tasks, Kanban, collaboration, real-time features, or AI. See the [product roadmap](docs/roadmap/product-roadmap.md) for approved future scope.

### Implemented

- pnpm/Turborepo monorepo
- React, Vite, and strict TypeScript web shell
- NestJS and strict TypeScript API
- validated backend environment configuration
- constrained development CORS configuration
- safe `GET /health` response
- PostgreSQL Docker Compose service with persistent volume and healthcheck
- ESLint, Prettier, type checking, Vitest smoke tests, and production builds
- GitHub Actions quality workflow

### Planned

Workspace-scoped multi-tenancy, secure identity and sessions, capability-based RBAC, project/task/Kanban workflows, collaboration, notifications, real-time updates, analytics, search, audit logs, AI planning and reporting, security/testing/performance hardening, production infrastructure, and UX polish are documented but intentionally not implemented yet.

## Technology

- Node.js 22+
- pnpm 10 and Turborepo
- React 19, Vite, TypeScript
- NestJS, Zod environment validation
- PostgreSQL 17 for local development
- Vitest, Testing Library, Supertest
- ESLint and Prettier

The long-term architecture remains a TypeScript modular monolith with PostgreSQL as the source of truth and Workspace as the tenant boundary. Redis, background workers, WebSockets, and AI adapters will be added only when the relevant feature needs them.

## Repository Structure

```text
apps/
  api/                 NestJS API foundation
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

The current API validates `NODE_ENV`, `API_PORT`, `WEB_ORIGIN`, and `DATABASE_URL` during startup. PostgreSQL connectivity is not part of the public Phase 1 health response, and no domain tables or migrations exist yet.

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
