# AI-Powered Multi-Tenant SaaS Project Management Platform

A full-stack project management SaaS with workspace tenant isolation, role-based authorization, persisted tasks, Kanban, collaboration, workspace dashboards, tenant-scoped text search and opt-in AI assistance with human-reviewed subtask creation.

## Status

**Foundation, authentication, Workspace/Tenancy/RBAC, Projects/Tasks/Kanban and the minimal Collaboration/Notifications/Realtime, Dashboard/Search and AI Assistant slices are implemented.** Comments, durable activity and own-user notifications extend the existing tenant boundary. SSE sends authorized refresh hints; PostgreSQL remains authoritative. Email delivery uses an explicitly development-only mailbox; production requires a delivery adapter and deployment hardening. See the [product roadmap](docs/roadmap/product-roadmap.md), [workspace contract](docs/architecture/workspace-tenancy.md), [resource contract](docs/architecture/projects-tasks.md), [collaboration contract](docs/architecture/collaboration-realtime.md), [collaboration verification](docs/verification/collaboration-notifications-realtime.md), [dashboard/search contract](docs/architecture/dashboard-search.md), and [dashboard/search verification](docs/verification/dashboard-search.md).

### Implemented

- [AI project summaries, task action plans and editable subtask previews](docs/architecture/ai-assistant.md), with explicit atomic apply, server-enforced permissions and cost controls; see [verification](docs/verification/ai-assistant.md)

- pnpm/Turborepo monorepo
- React, Vite, and strict TypeScript web shell
- NestJS and strict TypeScript API
- validated backend environment configuration
- constrained development CORS configuration
- safe `GET /health` response
- PostgreSQL user and session schema with deployable Prisma migration
- account registration and login with boundary validation and Argon2id password hashing
- login/register views with client validation, cookie-enabled API submission, and accessible loading/error/success feedback
- opaque, hashed, expiring, rotating, revocable cookie sessions
- authenticated profile, current-session logout, and all-session logout endpoints
- authentication rate limits and API-level lifecycle tests
- PostgreSQL Docker Compose service with persistent volume and healthcheck
- Prisma ORM persistence layer with the PostgreSQL driver adapter
- startup database connectivity verification and a baseline migration
- root scripts for validating and operating the local PostgreSQL service
- ESLint, Prettier, type checking, Vitest smoke tests, and production builds
- GitHub Actions quality workflow
- workspace creation/switching, memberships, invitations and server-enforced five-role governance
- workspace-scoped projects, tasks, one-level subtasks, current-member assignment and persisted Kanban
- plain-text comments with author-only versioned editing/deletion and idempotent creation
- transactional activity and assignment/comment notifications, unread count and read lifecycle
- session-authorized SSE hints, current-membership filtering, reconnect/refetch and manual fallback
- persisted workspace dashboard with active/archive projects, root/subtask counts, assignments and recent activity
- bounded PostgreSQL project/task/subtask text search in the keyboard command palette, with safe workspace switching

### Planned

Production email delivery, richer project/task fields, drag-and-drop, mentions/rich text, subtask discussion UI, notification preferences/digests, chat, presence, coediting, distributed realtime, analytics, advanced search/filters, comment search, audit logs, full AI project generation and reporting, production infrastructure, and further hardening remain deferred. Ownership transfer, explicit invitation decline and custom roles remain documented follow-ups.

## Technology

- Node.js 22+
- pnpm 10 and Turborepo
- React 19, Vite, TypeScript
- NestJS, Zod boundary validation, Prisma ORM, Argon2id
- PostgreSQL 17 for local development
- Vitest, Testing Library, Supertest
- ESLint and Prettier

The architecture remains a TypeScript modular monolith with PostgreSQL as the source of truth and Workspace as the tenant boundary. AI uses a provider abstraction; Redis, background workers and WebSockets remain deferred.

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
- PostgreSQL 17 (native local installation or Docker Compose)

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
pnpm db:up
pnpm db:status
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

The current API validates `NODE_ENV`, `API_PORT`, `WEB_ORIGIN`, `DATABASE_URL`, mail mode, and session policy configuration, and verifies PostgreSQL connectivity during startup. The baseline migration enables `pgcrypto`; later migrations add users, sessions, and account tokens.

`GET /health` reports process liveness. `GET /health/ready` performs a bounded PostgreSQL query and returns `{ "status": "ok" }` or a generic 503 without connection details. The readiness response deadline is 2.5 seconds, with shorter connection/transaction/statement limits. Both endpoints bypass request throttling and disable caching. The web indicator uses readiness, validates the JSON shape, aborts after five seconds, and cancels or ignores superseded requests; retry remains available.

## Database Workflow

Generate the Prisma Client after changing the schema:

```bash
pnpm --filter @platform/api prisma:generate
```

Apply committed migrations without resetting data:

```bash
pnpm --filter @platform/api prisma:migrate:deploy
```

Create a development migration only while implementing an approved schema change:

```bash
pnpm --filter @platform/api prisma:migrate:dev -- --name <migration-name>
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

The web app restores identity through `/auth/me` before showing the protected application shell. Without a valid session it opens the login view; use **Create an account** to register. The forms use `VITE_API_URL` and send credentials so the browser can accept the API's HttpOnly cookie. Keep the web and API on the same site (and use the same hostname locally) for the existing SameSite=Strict policy; `WEB_ORIGIN` must match the frontend origin. Production cookies require HTTPS.

Successful registration/login enters the application. Reloading restores the HttpOnly cookie session; **Sign out** and **Sign out all devices** revoke sessions and remove protected UI. Authenticated session requests distinguish 401 from permission errors, throttling, and temporary service failures. Only 401 or successful logout clears local identity. Bootstrap failures offer a bounded retry without displaying protected content. Returning to the tab revalidates identity. These transitions have component and real browser/PostgreSQL coverage.

Session rotation updates the existing row with a conditional token-hash comparison. Only the winning request sends a replacement cookie. The previous token hash remains usable for overlapping requests for at most 30 seconds, never beyond that token's original expiry; it cannot trigger another rotation. A losing rotation rechecks the persisted session before returning identity, so revocation and expiry still take effect. Only hashes are stored, including the predecessor. Apply the additive `20260905090000_harden_session_rotation` migration before running this API version.

Missing, malformed, unknown, expired, or revoked session credentials return 401. Session lookup/rotation infrastructure failures return a generic 500 without exposing internal details. Neither response clears cookies: a delayed response must not erase a newer cookie from another request. Explicit logout and logout-all revoke sessions and clear the browser cookie. A request using the predecessor after its grace period receives 401; if the winning replacement response is lost entirely, signing in again is required after grace expires.

## Workspaces, membership and invitations

After signing in, open **Workspaces** in the sidebar. Create a workspace, switch with **Active workspace**, rename it, and manage members according to your role. Workspace selection survives reload through a non-authoritative URL preference; the server validates membership each time. Removed memberships and forbidden actions are distinct from temporary service failures.

The creator is the single Owner. Owner can manage all non-owner roles and delete the workspace. Admin can rename and manage only Manager/Member/Viewer. Manager, Member and Viewer can view workspace/members and leave. Owner cannot leave, be removed or be demoted. No invitation grants Owner and no self role changes are supported. These rules are enforced server-side; hidden UI controls are only convenience.

Apply `20260918000000_workspace_tenancy` with the existing migration deployment command. It adds Workspace, WorkspaceMembership, WorkspaceInvitation and the five-role enum. PostgreSQL constraints enforce membership uniqueness, exactly one matching owner, non-owner invitations, and workspace-owned cascade deletion. Names are 2–100 trimmed characters; UUIDs provide stable identity without a public slug namespace.

| Method               | Path                                                 | Result                                                                                     |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET / POST           | `/workspaces`                                        | List own workspaces / atomically create workspace and Owner membership                     |
| GET / PATCH / DELETE | `/workspaces/:workspaceId`                           | Detail with members, manageable invitations and permissions / rename / Owner-only deletion |
| POST                 | `/workspaces/:workspaceId/leave`                     | Non-owner leaves                                                                           |
| PATCH / DELETE       | `/workspaces/:workspaceId/members/:userId`           | Change non-owner role / remove eligible member                                             |
| POST                 | `/workspaces/:workspaceId/invitations`               | Issue or reissue `{ email, role }`                                                         |
| DELETE               | `/workspaces/:workspaceId/invitations/:invitationId` | Revoke an authorized invitation                                                            |
| POST                 | `/workspaces/invitations/accept`                     | Accept `{ token }` for the authenticated matching email                                    |

Creation/rename accepts `{ name }`; role change accepts `{ role }`. Anonymous requests receive 401; non-member and nonexistent workspace IDs both receive 404; insufficient member permissions receive 403. Invalid input/link is 400, conflicting membership or resend cooldown is 409, request throttling is 429, unavailable delivery is 503, and unexpected infrastructure errors return a generic 500. All workspace responses disable caching and use the existing safe headers and origin policy.

Invitations expire in seven days, use hashed 256-bit random tokens and consume atomically with membership creation. Resending replaces the old link after a one-minute cooldown. Revoke/replay/expiry/mismatched email fail safely; acceptance also checks that the inviter still has authority. Set `MAIL_MODE=development-file` to deliver private local links to ignored `.tools/mail/*.json`. Open the link, sign in or register with the invited email, then explicitly accept. Reopen the original link if the page is reloaded before acceptance. Production delivery remains unavailable until an actual mail adapter is configured; no external email is sent by tests.

`WorkspaceAccess.run` reloads membership and evaluates capabilities inside a transaction locking the workspace row; repository operations bind the workspace ID. Role changes/removal/acceptance/deletion and Projects/Tasks use the same lock and preserve the [workspace-level guarantees](docs/architecture/workspace-tenancy.md).

## Projects, tasks and Kanban

Open **Projects**, select a workspace, create a project and open its board. Owner/Admin/Manager can administer projects and delete or assign tasks. Member can create/edit/move tasks and subtasks and self-assign an unassigned item; Viewer is read-only. Manager still cannot administer workspace membership or settings.

Task status is **To do → In progress → Done**, with transitions in either direction. Use the status select, **Up** and **To end** controls with mouse or keyboard. Open a task to edit its description, select an assignee, and create/edit/complete one-level subtasks. State and ordering survive reload. Stale edits return a conflict and reload current state for review. Assignment is restricted to current workspace members; leaving/removal clears existing assignments atomically.

Project settings support rename/description, archive/restore and confirmed permanent deletion. Archived projects remain readable; restoring enables task edits. Deleting a project intentionally deletes its tasks/subtasks. All resource lists page at 50 rows. The [resource contract](docs/architecture/projects-tasks.md) records schema constraints, routes, RBAC, status, assignment and ordering details.

Apply the additive `20260919000000_projects_tasks` migration with `pnpm --filter @platform/api prisma:migrate:deploy`. It adds Project, Task and TaskStatus, composite tenant/parent/assignee constraints, and one-level/assignment-cleanup triggers. Earlier migrations are unchanged.

### PostgreSQL without Docker (Windows)

Use a separate disposable cluster with the installed PostgreSQL binaries, for example under ignored `.tools/pg-workspace-tests` on loopback port 55432. Do not point `initdb` or test cleanup at an existing database directory. If this directory or port already exists, inspect it and select a new test location instead of resetting it. Create an ignored password file containing a disposable local password, then:

```powershell
& 'C:\Program Files\PostgreSQL\17\bin\initdb.exe' -D .tools/pg-workspace-tests -U platform_auth_test --auth=scram-sha-256 --pwfile=.tools/test-db-password.txt --encoding=UTF8 --locale=C
& 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe' -D .tools/pg-workspace-tests -l .tools/pg-workspace-tests.log -o '-p 55432 -h 127.0.0.1' -w start
& 'C:\Program Files\PostgreSQL\17\bin\createdb.exe' -h 127.0.0.1 -p 55432 -U platform_auth_test -W platform_auth_test
$env:DATABASE_URL='postgresql://platform_auth_test:YOUR_DISPOSABLE_PASSWORD@127.0.0.1:55432/platform_auth_test?schema=public'
$env:WEB_ORIGIN='http://localhost:5173'
$env:NODE_ENV='test'
pnpm --filter @platform/api prisma:migrate:deploy
pnpm --filter @platform/api test:integration
pnpm build
$env:E2E_BROWSER_CHANNEL='msedge' # optional installed Edge; CI uses Chromium
pnpm --filter @platform/web test:e2e
& 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe' -D .tools/pg-workspace-tests -m fast -w stop
```

Integration fixtures delete only their own records. Browser fixtures remain in the explicitly disposable database; no real database is reset. Keep local test mail/database files private. All six migrations were also verified from a fresh database.

## Quality Commands

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @platform/api test:integration
pnpm build
pnpm docker:config
```

Integration tests require the local PostgreSQL service, an `.env` with a valid `DATABASE_URL`, and all committed migrations applied (`pnpm --filter @platform/api prisma:migrate:deploy`). They cover connectivity and session creation, expiry, concurrent conditional rotation, predecessor grace, and revocation. Session fixtures use unique accounts and delete only their own data; no database reset is performed. HTTP error/cookie and forced service-level race regressions use `MemoryAuthRepository` in the regular API suite.

Database lifecycle helpers are also available through `pnpm db:up`, `pnpm db:status`, `pnpm db:logs`, and `pnpm db:down`. `db:down` stops the local stack but preserves the named PostgreSQL volume; use explicit Docker volume commands only when intentional data removal is required.

### Browser verification

Use a disposable PostgreSQL database named `platform_auth_test`, inject its `DATABASE_URL` explicitly, and apply migrations before running:

```bash
pnpm build
pnpm --filter @platform/web exec playwright install chromium
pnpm --filter @platform/web test:e2e
```

The suite starts its own API and web servers on ports 3000 and 5173, refuses to reuse existing servers, and uses real browser cookies and database writes. It exercises registration/login, refresh restoration, logout, verification, password reset and other-device revocation, plus modal keyboard and small-viewport behavior. Unique test accounts remain in this disposable database; discard the test database when finished. Only mail files matching the unique test account are removed. No test sends real email. Traces, videos, and screenshots are disabled to avoid recording recovery credentials.

When Chromium download is unavailable but Microsoft Edge is installed, set `E2E_BROWSER_CHANNEL=msedge`. Local verification on Windows used an isolated PostgreSQL 17 cluster under ignored `.tools`, listening only on `127.0.0.1:55432`, because Docker Desktop's engine failed. It did not use or reset the installed database service. CI uses its own disposable PostgreSQL service and Chromium.

CI retains frozen installation, format, lint, typecheck, unit tests, builds, and Compose validation. The PostgreSQL 17 job applies migrations to a clean disposable database, runs integration regressions, builds the applications, installs Chromium, and runs real browser authentication, workspace, project/Kanban, collaboration and dashboard/search journeys. Both jobs run on pull requests and pushes to main, feature/authentication, feature/workspaces-rbac, feature/projects-tasks-kanban, feature/collaboration-notifications-realtime, or feature/dashboard-search. Deployment remains outside this phase.

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Full product roadmap](docs/roadmap/product-roadmap.md)
- [Foundation verification](docs/verification/foundation.md)
- [Coding-agent guidance](AGENTS.md)

### Concurrent session policy

Session creation and logout-all serialize on the user's PostgreSQL row. Each creation prunes to ten active sessions ordered by `createdAt DESC, id DESC`. Concurrent requests cannot independently overfill the cap. A login serialized before logout-all is revoked; one serialized afterward creates a new valid session. Rotation cannot resurrect revoked sessions. Real PostgreSQL regressions verify concurrent creation, timestamp ties, rotation, and revocation.

### Lifetime, retention, and deployment configuration

`SESSION_TTL_HOURS` defaults to 168, `SESSION_ROTATION_HOURS` to 24, and `SESSION_ABSOLUTE_HOURS` to 720. Rotation must be strictly shorter than TTL; TTL cannot exceed absolute lifetime. A session never authenticates beyond `createdAt + absolute lifetime`, even after rotations. Replacement cookie lifetime is capped at this boundary. Configuration changes apply to existing sessions too.

Expiry slides only when the current token rotates; ordinary reads and predecessor requests do not extend expiry. The effective inactivity window is therefore between TTL minus rotation interval and TTL. `lastSeenAt` is deliberately sampled: it records creation or successful rotation, not every request, and must not be shown as an exact last-active time.

Retain expired/revoked rows for 30 days for troubleshooting. An operator may periodically run the following bounded cleanup (repeat until zero rows); no scheduler or Redis is required. The 120-day bound also covers absolute expiry under the maximum supported 90-day configuration plus retention.

```sql
DELETE FROM sessions WHERE id IN (
  SELECT id FROM sessions
  WHERE expires_at < now() - interval '30 days'
     OR revoked_at < now() - interval '30 days'
     OR created_at < now() - interval '120 days'
  ORDER BY id LIMIT 500
);
```

`WEB_ORIGIN` must be a canonical HTTP(S) origin without credentials, trailing slash, path, query, or fragment. Production requires HTTPS. Serve web and API on the same HTTPS site (prefer a single origin with `/auth` routed to the API); cross-site deployment is unsupported with SameSite=Strict. Production cookies keep Secure, HttpOnly, Path=/, no Domain, and the `__Host-` prefix. The API currently supports one directly exposed process or an edge that preserves a trustworthy client address without trusting arbitrary forwarding headers; multi-replica rate limiting is not supported yet.

Turbo accounts for ignored root `.env` files and public output variables. Backend `DATABASE_URL` is passed only to processes, never exposed through a `VITE_*` name; tests are uncached. Vite loads the root env for public variables; Nest and Prisma read the root env and prefer injected shell values. Development PostgreSQL binds to loopback by default.

### Verification and password recovery

Apply the new `20260917000000_account_recovery` migration. `account_tokens` stores SHA-256 hashes, purpose, issuance/expiry, and consumption timestamps; it never stores the raw credential. Verification expires after 24 hours; password reset after 30 minutes. Consumption, identity mutation, and reset-driven session revocation are atomic. Resending replaces the previous link, with a database-enforced one-minute per-account/purpose cooldown and five HTTP attempts per minute per client/endpoint.

- `POST /auth/resend-verification` and `POST /auth/forgot-password`: `{ email }`, generic 202 for eligible, unknown, verified, or cooldown cases.
- `POST /auth/verify-email`: `{ token }`, 204 on success.
- `POST /auth/reset-password`: `{ token, password }`, 204 on success; every session is revoked. No replacement session is issued.
- Malformed/expired/used links return 400; throttling returns 429; unavailable delivery returns 503 honestly.

The account shell exposes **Verify email**; login exposes **Forgot password?**. Email links use fragments, which are removed from browser history after reading and never sent to the server as URL parameters. Verification requires an explicit confirmation; reset requires a new valid password.

For local development set `MAIL_MODE=development-file` in the ignored root `.env`. Requests deliver JSON messages into ignored `.tools/mail/*.json`; open the `url` locally to exercise the flow. This mailbox contains real development credentials: keep it private and delete messages when testing ends. It is not served over HTTP and secrets are never printed in application logs. `MAIL_MODE=disabled` is the default. Production forbids the development transport and returns 503 until a real `AccountMailDelivery` adapter is installed; no production delivery is claimed. Tests override delivery and do not send real email.

Login verifies the password again under the same user-row lock by comparing the hash that was authenticated. A login racing with password reset cannot create a new session from the old password after reset completes. Session rotation continues to honor revocation.

Account token rows may be removed in bounded batches once `expires_at` is more than 30 days old, using the same operator-driven retention approach as sessions.

Authentication responses, including guard/validation/rate-limit failures, receive early `Cache-Control: no-store`. API responses have nosniff, frame denial, no-referrer, and restrictive CSP headers; production adds HSTS. Mutations reject mismatched Origin, and auth endpoints reject cross-site Fetch Metadata. Clients without Origin remain supported for non-browser use; browser CORS stays restricted. Forwarding headers are not trusted. Unexpected request errors return a generic response and only a static failure message is logged.
