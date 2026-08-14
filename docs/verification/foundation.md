# Foundation Verification

This record captures the completed Phase 1 acceptance checks. It documents commands and observable outcomes without claiming that later product, integration, security, or deployment suites already exist.

## Application Quality

The following root commands were executed successfully against the committed dependency graph:

```text
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The web and API each have one meaningful smoke test. The production build covers both applications. The API was also started from its production output and `GET /health` returned only:

```json
{ "status": "ok" }
```

## Docker and PostgreSQL

Verified on 2026-08-14 with Docker Desktop 4.86.0, Docker Engine 29.7.2, Docker Compose 5.3.1, and the repository's `postgres:17-alpine` service.

The following checks succeeded:

```text
docker compose config --quiet
docker compose up -d postgres
docker compose ps postgres
docker compose exec -T postgres pg_isready -U project_platform -d project_platform
docker compose exec -T postgres psql -U project_platform -d project_platform -tAc "SELECT current_database(), current_user;"
```

Observed acceptance results:

- the Compose network and named PostgreSQL volume were created successfully;
- the PostgreSQL container reached `healthy` state;
- `pg_isready` reported that the server was accepting connections;
- the read-only query returned `project_platform|project_platform`, confirming the expected database and role;
- no domain tables, Prisma models, or migrations were introduced.

## Reproducing Locally

After copying `.env.example` to `.env` and choosing a local-only password, run:

```bash
pnpm docker:config
pnpm db:up
pnpm db:status
```

Inspect startup logs with `pnpm db:logs`. Stop the stack with `pnpm db:down`; the named volume remains intact. The committed example credentials are development placeholders and must not be used in production.
