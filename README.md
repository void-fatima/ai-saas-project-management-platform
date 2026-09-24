# Project Platform

### AI-assisted, multi-tenant project management for real team workflows.

[![CI](https://github.com/void-fatima/ai-saas-project-management-platform/actions/workflows/quality.yml/badge.svg)](https://github.com/void-fatima/ai-saas-project-management-platform/actions)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-TypeScript-E0234E?logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Production%20Ready-2496ED?logo=docker&logoColor=white)

Project Platform is a production-oriented SaaS application for planning and running collaborative project work across isolated workspaces.

It combines multi-tenant authorization, project and task management, persisted Kanban workflows, realtime collaboration, AI-assisted planning, analytics, reporting, audit history, and a containerized production deployment model in one full-stack system.

![Workspace overview](docs/screenshots/workspace-overview.png)

---

## Why this project exists

Project management applications look deceptively simple until authentication, tenancy, authorization, collaboration, ordering, concurrent updates, reporting, AI integration, and production operations all have to work together.

Project Platform was built around those harder boundaries.

The core hierarchy is:

```text
User
└── Workspace
    └── Project
        └── Task
            └── Subtask
```

A workspace is the tenant boundary. Data access, mutations, search, reporting, AI context, notifications, and audit history are all scoped server-side rather than relying on client-provided IDs alone.

---

## Highlights

- Multi-tenant workspace isolation with server-enforced RBAC
- Secure authentication and hardened session lifecycle
- Workspace invitations and membership management
- Projects, tasks, one-level subtasks, and assignments
- Persisted Kanban ordering with stale-update protection
- Comments, activity history, notifications, and realtime SSE updates
- Workspace dashboard and ranked workspace-scoped search
- Structured AI project/task assistance with explicit preview/apply workflows
- Workspace and project analytics
- Reports and CSV export
- Immutable tenant-scoped audit history
- Production health/readiness, structured logging, graceful shutdown, and rate limits
- Multi-stage production Docker images and production Compose deployment
- PostgreSQL migration, backup, restore, and recovery workflows
- Extensive unit, integration, PostgreSQL, and browser E2E coverage

---

## Product walkthrough

### Projects

Projects are workspace-scoped and support lifecycle operations including creation, updates, archiving, and restoration.

![Projects](docs/screenshots/projects.png)

### Tasks, subtasks, and Kanban

Tasks support status transitions, assignment to current workspace members, one-level subtasks, persisted ordering, and version-aware updates.

The Kanban workflow uses:

```text
TODO → IN_PROGRESS → DONE
```

Ordering is persisted in PostgreSQL rather than being a frontend-only representation.

![Kanban board](docs/screenshots/kanban.png)

### AI-assisted planning

AI is integrated into existing project-management workflows rather than exposed as a disconnected chatbot.

Supported flows include:

- project summaries
- task action plans
- structured task breakdown
- editable subtask previews
- explicit confirmation before generated subtasks are persisted

Provider output is schema-validated server-side, tenant context is bounded, secrets remain server-only, and AI-generated resource changes still pass through normal authorization and domain rules.

![AI task breakdown](docs/screenshots/ai-assistant.png)

The screenshot shows the existing deterministic test provider in an isolated local test environment; it is not live-model output.

### Analytics, reports, and audit history

Workspace and project reporting is generated from persisted application data.

The platform includes:

- task and subtask status distributions
- completion metrics
- member workload
- recent activity trends
- workspace and project reports
- safe CSV export
- Owner/Admin-only audit history

![Analytics and reports](docs/screenshots/analytics-reports.png)

---

## Role-based access control

Authorization is enforced on the server.

| Capability               | Owner |         Admin         | Manager | Member | Viewer |
| ------------------------ | :---: | :-------------------: | :-----: | :----: | :----: |
| View workspace resources |   ✓   |           ✓           |    ✓    |   ✓    |   ✓    |
| Create/manage projects   |   ✓   |           ✓           |    ✓    |   —    |   —    |
| Create/edit/move tasks   |   ✓   |           ✓           |    ✓    |   ✓    |   —    |
| Self-assign tasks        |   ✓   |           ✓           |    ✓    |   ✓    |   —    |
| Manage workspace members |   ✓   | Limited by role rules |    —    |   —    |   —    |
| Invite members           |   ✓   | Limited by role rules |    —    |   —    |   —    |
| View analytics/reports   |   ✓   |           ✓           |    ✓    |   ✓    |   ✓    |
| View audit history       |   ✓   |           ✓           |    —    |   —    |   —    |
| Delete workspace         |   ✓   |           —           |    —    |   —    |   —    |

Owners may manage all non-owner roles; Admins may manage and invite only Managers, Members, and Viewers. The single Owner cannot leave, be removed, or be demoted. Ownership transfer is deferred. See the [workspace RBAC contract](docs/architecture/workspace-tenancy.md) and [project/task permissions](docs/architecture/projects-tasks.md).

---

## Architecture

```mermaid
flowchart LR
    B[React Web App] -->|HTTPS / Cookie Session| A[NestJS API]
    A --> P[(PostgreSQL)]
    A --> AI[AI Provider Adapter]
    A --> SSE[SSE Notifications]
    A --> M[SMTP / Development Mail]

    subgraph Tenant Boundary
      W[Workspace]
      PR[Projects]
      T[Tasks]
      ST[Subtasks]
      C[Comments]
      R[Reports]
      AU[Audit]
    end

    W --> PR
    PR --> T
    T --> ST
    T --> C
    W --> R
    W --> AU
```

### Frontend

- React 19
- TypeScript
- Vite
- responsive authenticated application shell
- stale-request cancellation and workspace-switch protection
- accessible forms, loading states, errors, previews, and confirmations

### API

- NestJS
- TypeScript
- cookie-based authentication
- server-enforced RBAC
- tenant-scoped resource access
- rate limiting
- structured operational logging
- request/correlation IDs
- health and readiness endpoints
- graceful shutdown

### Persistence

- PostgreSQL
- Prisma ORM
- additive migrations
- transactional domain operations
- persisted Kanban ordering
- durable notifications, audit history, and AI request controls

---

## Authentication and sessions

Authentication includes more than basic login/logout.

The application supports:

- registration
- login
- logout
- logout from all devices
- session rotation
- absolute session lifetime
- session limits
- email verification workflow
- password recovery workflow
- secure cookie configuration
- production-safe error handling

Session state is stored and validated server-side.

---

## Multi-tenancy

Project-management resources belong to a workspace boundary. Accounts and sessions are user-scoped; notifications also require the authenticated recipient and current workspace membership.

Server-side checks ensure that a user cannot cross workspace boundaries by supplying another tenant's:

- workspace ID
- project ID
- task ID
- subtask ID
- comment ID
- notification ID
- report query
- search query
- AI context
- audit filter

Tenant isolation is covered by real PostgreSQL integration tests in addition to unit-level authorization tests.

---

## Realtime collaboration

Collaboration features include:

- task comments
- activity history
- assignment notifications
- persisted notification state
- Server-Sent Events for realtime refresh hints

Persisted database state remains the source of truth. Realtime delivery does not replace normal authorization or persistence checks.

---

## Search

Workspace search covers persisted resources with deterministic ranking and pagination.

Ranking favors:

1. exact title matches
2. title prefixes
3. title substring matches
4. description matches

Search remains workspace-scoped and stale requests are prevented from overwriting a newly selected workspace.

---

## AI architecture

AI business logic does not depend directly on a provider SDK.

The API uses a provider abstraction responsible for:

- model configuration
- structured response generation
- normalized provider errors
- provider/model metadata
- usage metadata when available

Production AI access is opt-in.

```env
AI_PROVIDER=disabled
AI_MODEL=your-model-id
AI_API_KEY=your-server-only-key
```

Automated tests use deterministic providers and never require live external AI calls.

Additional controls include:

- bounded context
- output limits
- deadlines
- per-user/workspace request limits
- schema validation
- explicit apply operations
- no frontend API keys
- no raw AI prompt/response logging

---

## Audit history

The audit system is distinct from the user-facing activity feed.

Audit entries are:

- workspace-scoped
- server-generated
- append-only through normal application flows
- attributable to an actor where applicable
- transactionally coupled to meaningful mutations where practical

Audit metadata intentionally avoids passwords, cookies, session tokens, API keys, and arbitrary request bodies.

Only workspace Owners and Admins can read the audit history.

---

## Production readiness

This repository includes a production-oriented runtime rather than only a development server.

Operational capabilities include:

- validated production configuration
- `/health` liveness endpoint
- `/ready` dependency readiness endpoint
- structured/redacted logs
- request correlation IDs
- secure HTTP headers
- exact-origin CORS
- request size limits
- production-safe errors
- graceful `SIGTERM` / `SIGINT` shutdown
- database migration gating
- restricted database runtime access
- backup and restore tooling
- deployment and rollback documentation

---

## Docker deployment

Production packaging includes dedicated images for:

- API
- web
- database migration execution

The web application is built to static production assets rather than running the Vite development server in production.

The production Compose stack includes:

```text
PostgreSQL
    ↑
Migration job
    ↓
API
    ↓
Web
```

The stack uses health checks, persistent database storage, restart policies, internal networking, and explicit environment injection.

See:

```text
docs/deployment/production.md
```

for the full deployment and recovery runbook.

---

## Local development

### Prerequisites

- Node.js 22.12+ within 22.x, or 24+
- pnpm 10.15.0 (pinned in `package.json`)
- PostgreSQL 17
- Docker Desktop for container workflows

### 1. Clone

```bash
git clone https://github.com/void-fatima/ai-saas-project-management-platform.git
cd ai-saas-project-management-platform
```

### 2. Install dependencies

```bash
pnpm install --frozen-lockfile
```

### 3. Configure environment

Copy:

```text
.env.example
```

to:

```text
.env
```

and configure at least the local PostgreSQL credentials.

Example:

```env
NODE_ENV=development
API_PORT=3000
WEB_ORIGIN=http://localhost:5173
VITE_API_URL=http://localhost:3000

POSTGRES_DB=project_platform
POSTGRES_USER=project_platform
POSTGRES_PASSWORD=your-local-password
DATABASE_URL=postgresql://project_platform:your-local-password@localhost:5432/project_platform?schema=public

MAIL_MODE=development-file
AI_PROVIDER=disabled
```

Never commit real credentials.

### 4. Apply migrations

Start the local PostgreSQL service with `pnpm db:up` and check it with `pnpm db:status`, or use an existing local database. Then apply the committed migrations:

```bash
pnpm --filter @platform/api exec prisma migrate deploy
```

Development migration workflows may require a PostgreSQL role that is allowed to create Prisma's shadow database.

### 5. Start development

```bash
pnpm dev
```

Then open:

```text
http://localhost:5173
```

API:

```text
http://localhost:3000
```

---

## Environment configuration

Important variables include:

| Variable                 | Purpose                                 |
| ------------------------ | --------------------------------------- |
| `DATABASE_URL`           | PostgreSQL connection                   |
| `WEB_ORIGIN`             | Allowed frontend origin                 |
| `VITE_API_URL`           | Browser-facing API origin               |
| `SESSION_TTL_HOURS`      | Rotating session lifetime               |
| `SESSION_ROTATION_HOURS` | Session rotation interval               |
| `SESSION_ABSOLUTE_HOURS` | Absolute session lifetime               |
| `MAIL_MODE`              | Development or SMTP mail transport      |
| `AI_PROVIDER`            | Enables/disables configured AI provider |
| `AI_MODEL`               | Provider model                          |
| `AI_API_KEY`             | Server-only provider credential         |
| `AI_TIMEOUT_MS`          | AI request timeout                      |
| `AI_MAX_OUTPUT_TOKENS`   | AI response limit                       |
| `RATE_LIMIT_MAX`         | Request limit                           |
| `RATE_LIMIT_WINDOW_MS`   | Rate-limit window                       |
| `SHUTDOWN_TIMEOUT_MS`    | Graceful shutdown timeout               |

See `.env.example` and `.env.production.example` for the complete supported configuration.

---

## Database migrations

Prisma migrations are committed to the repository and validated against clean PostgreSQL databases.

Production deployment uses:

```bash
prisma migrate deploy
```

Development-only destructive reset commands are not part of the production startup path.

---

## Backup and restore

The repository includes documented PostgreSQL backup and restore operations.

The production verification path checks:

- compressed backup creation
- restoration into a disposable target
- refusal to overwrite unsafe existing data
- migration compatibility after restore

See the production deployment runbook for exact commands.

---

## Verification

The [final completion audit](docs/verification/final-completion.md) and [successful Quality run](https://github.com/void-fatima/ai-saas-project-management-platform/actions/runs/35895348875) at commit `174955b` verified:

- **89 API tests**
- **126 web tests**
- **115 PostgreSQL integration tests**
- **3 browser E2E journeys**

It also verified:

- formatting
- linting
- TypeScript checks
- production API build
- production web build
- all database migrations
- schema drift checks
- API Docker image
- web Docker image
- migration image
- production Compose configuration
- live production Compose smoke testing
- backup/restore
- database-outage readiness
- graceful SSE shutdown

GitHub Actions is the final release verification environment.

---

## Repository structure

```text
.
├── apps/
│   ├── api/            # NestJS API
│   └── web/            # React + Vite frontend
├── deploy/             # Production deployment helpers
├── docs/
│   ├── deployment/     # Production runbook
│   ├── screenshots/    # Product screenshots
│   └── verification/   # Milestone/final verification records
├── scripts/            # Operational and smoke-test scripts
├── compose.production.yaml
├── docker-compose.yml
├── .env.example
└── .env.production.example
```

---

## Engineering principles

A few decisions intentionally shape the codebase:

**Tenant boundaries belong on the server.**  
The frontend is never considered an authorization boundary.

**Persisted state is the source of truth.**  
Realtime messages trigger refreshes; they do not replace database state.

**AI suggestions are not trusted application data.**  
They are validated, bounded, previewed, and explicitly applied.

**Production behavior is tested.**  
Containers, migrations, readiness, backup/restore, and graceful shutdown are part of CI verification.

**Complexity has to earn its place.**  
The project deliberately avoids adding infrastructure such as Redis, Kubernetes, vector databases, or cloud-specific IaC until the product actually requires them.

---

## Current status

**PROJECT CORE COMPLETE**

The current core product includes authentication, multi-tenancy, RBAC, project management, collaboration, realtime updates, dashboard/search, AI assistance, analytics, reports, audit history, and production operations.

### Future enhancements

Potential future work includes:

- richer task metadata
- advanced search and analytics
- RAG / vector-backed AI context
- full AI project generation
- scheduled reports
- full-dataset exports
- distributed realtime fan-out

The complete approved deferred scope is preserved in the [product roadmap](docs/roadmap/product-roadmap.md).

### Deployment-specific work

The following intentionally remains environment-specific:

- public domain and TLS termination
- live SMTP acceptance testing
- live AI-provider acceptance testing
- off-host backup retention
- external monitoring/alerting
- operational ownership and incident procedures

---

## Final verification record

The final repository audit is documented at:

```text
docs/verification/final-completion.md
```

The project was audited for:

- RBAC consistency
- tenant isolation
- security boundaries
- database integrity
- complete user journeys
- accessibility
- loading/error/empty states
- dead/debug code
- documentation accuracy
- production readiness

No core repository blockers remained after the final audit.

---

Built as a full-stack engineering project focused on the parts of SaaS development that become difficult after the first CRUD screen: boundaries, consistency, failure modes, and production behavior.

---
