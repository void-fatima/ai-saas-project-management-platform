# Production deployment runbook

## Prerequisites and topology

Use a Linux Docker host with Docker Compose v2 supporting health dependencies, `--wait` and completed one-shot services. Allow adequate build memory (4 GiB or more is a practical starting point), persistent disk and a TLS certificate for a real public domain. The host TLS edge is operator-managed; [Nginx configuration](../../deploy/tls-edge.conf.example) is provided. It must overwrite `X-Real-IP`, preserve Host/Origin, support SSE without buffering, and forward only to `127.0.0.1:8080`. Do not expose the API or database ports or publish the web port publicly. Public HTTP redirects to HTTPS. If another edge is used, reproduce this exact trust boundary.

Run one API instance. PostgreSQL stores all authoritative data; limits and realtime subscriptions are in memory. Compose performs no cloud provisioning or certificate issuance. [Operational guarantees and limits](../architecture/production-operations.md) explain the security/lifecycle contract.

## Configuration

Copy `.env.production.example` to `.env.production`, restrict its permissions to the deployment operator, and fill required blanks. Never commit it, pass credentials as build arguments, print `docker compose config` without `--quiet`, or enable SMTP/body/header logging. Environment values and container inspection are visible to Docker administrators; restrict host access.

| Setting                                                                 | Contract                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_DB`, `POSTGRES_USER`                                          | Defaults `platform`, `platform_migrator`; initial database and migration administrator                                                                                   |
| `POSTGRES_PASSWORD`, `APP_DATABASE_PASSWORD`                            | Required, independent strong passwords; use secret-manager/generated values                                                                                              |
| `MIGRATION_DATABASE_URL`                                                | Required PostgreSQL URL for administrator on `postgres:5432` and the configured database                                                                                 |
| `DATABASE_URL`                                                          | Required PostgreSQL URL for `platform_app`, matching `APP_DATABASE_PASSWORD`; never use the administrator in the API                                                     |
| `WEB_ORIGIN`                                                            | Required exact HTTPS origin, no slash/path/query/credentials; example `https://app.example.com`                                                                          |
| `WEB_PORT`, `IMAGE_TAG`                                                 | Loopback web port (8080), release image tag (`local` for local builds); use a release SHA in deployments                                                                 |
| `NODE_ENV`, `API_PORT`, `TRUST_PROXY_HOPS`                              | Compose fixes production, 3000 and one private web-proxy hop; direct API deployments default to zero trusted hops                                                        |
| `LOG_LEVEL`                                                             | `info` (default), `warn`, `error`; no debug/body logging                                                                                                                 |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`                                | Default 100 per route/client/60,000 ms; bounded 10–1,000 and 10,000–300,000 ms; auth-specific limits remain stricter                                                     |
| `SESSION_TTL_HOURS`, `SESSION_ROTATION_HOURS`, `SESSION_ABSOLUTE_HOURS` | Defaults 168/24/720; rotation < TTL ≤ absolute lifetime; bounded by startup validation                                                                                   |
| `SHUTDOWN_TIMEOUT_MS`                                                   | Direct API: 1,000–30,000 ms, default 10,000; Compose fixes 10,000 and a 15-second stop grace period                                                                      |
| `MAIL_MODE`                                                             | `disabled` or `smtp` in production. Disabled verification, recovery and invitation delivery fail explicitly                                                              |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`                  | Required when SMTP enabled; sender must be an email address authorized by the provider                                                                                   |
| `SMTP_PORT`, `SMTP_SECURE`                                              | 587/false default requires STARTTLS; use 465/true for implicit TLS. Certificate checks cannot be disabled                                                                |
| `AI_PROVIDER`                                                           | `disabled` default or `openai`; deterministic `test` is forbidden in production                                                                                          |
| `AI_MODEL`, `AI_API_KEY`                                                | Required only for live AI; provider key stays in the API container                                                                                                       |
| `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`                                 | Defaults 15,000/2,048, bounded 100–30,000 ms and 256–4,096 tokens                                                                                                        |
| `VITE_API_URL`                                                          | Docker fixes `/api` at build time; standalone production builds allow `/api` or an HTTPS origin. Cross-origin deployments additionally need their own CSP/routing review |

URL-encode password components in database URLs; raw database passwords must match the decoded values. The internal Compose database uses a private local network without TLS. For an external database, configure certificate-verified TLS and remove/replace the local database service intentionally. AI and SMTP require operator-managed credentials and network access; neither is needed for tests. Enable and verify SMTP before launching account recovery/invitations to users. Configure sender DNS/authentication with your provider; bounce handling/outbox retries are future work.

## First deployment and migrations

Commands below are shell-neutral; run from the repository root. Keep the same Compose project and env file for every command.

```sh
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d --wait --wait-timeout 180
docker compose --env-file .env.production -f compose.production.yaml ps -a
```

The fresh volume initializes the restricted API role. The `migrate` service runs **only** `prisma migrate deploy`; failure prevents API/web startup. It must exit zero. No runtime container resets or develops schemas. All ten committed migrations remain intact. Re-running the migration command is safe:

```sh
docker compose --env-file .env.production -f compose.production.yaml run --rm migrate
```

The bootstrap role script runs only on an empty PostgreSQL volume. Existing databases must have `platform_app` provisioned and equivalent default privileges configured by their administrator before first use. Do not delete a volume to rerun provisioning. Password rotation requires an explicit SQL role password change and matching configuration update; editing `.env.production` alone does not change persisted roles.

## Smoke checks and logs

Through your HTTPS edge, check `/`, a refreshed deep link, `/api/health` and `/api/ready`. Register/sign in, verify the `__Host-platform_session` cookie has Secure/HttpOnly/SameSite=Strict/Path=/ and no Domain, then verify email/invitation delivery using configured SMTP. Check SSE reconnects and workspace changes. Docker health verifies process liveness; external traffic checks should use readiness. A database outage returns readiness 503 while liveness stays 200 after startup.

```sh
docker compose --env-file .env.production -f compose.production.yaml logs --tail 100 api migrate
docker compose --env-file .env.production -f compose.production.yaml ps -a
```

Logs rotate locally (three 10 MiB files per service). Correlate safe JSON events using `X-Request-ID`. Protect logs as operational data and arrange collection/retention if required; no vendor or alert service is configured automatically.

`node scripts/production-smoke.mjs` builds images and verifies an **isolated disposable** stack with generated credentials, registration, cookies, limits, restricted database permissions, migrations, backup/restore, database failure and SIGTERM with SSE. It removes only its uniquely named test volume. `--config-only` validates wiring without a Docker engine. It does not provision a real TLS domain or contact SMTP/AI providers.

## Backup and restore

PostgreSQL 17 client tools are included in the database container. Helpers also work with normal PostgreSQL client tools and `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSFILE`/`PGPASSWORD`. Prefer a restricted password file; never put passwords in command text. The backup uses a consistent compressed custom archive, restrictive file permissions and exclusive output publication. It refuses to overwrite an existing backup. It captures the named database, including migrations and audit history, but not cluster roles/passwords.

```sh
docker compose --env-file .env.production -f compose.production.yaml exec -T -e PGDATABASE=platform -e PGUSER=platform_migrator postgres sh /operations/backup.sh /tmp/release.dump
docker compose --env-file .env.production -f compose.production.yaml cp postgres:/tmp/release.dump ./release.dump
```

Move the backup to encrypted storage outside the Docker host, verify checksum/size, restrict access and remove temporary copies after verifying transfer. Backups include personal data and hashed credentials. Define your retention and recovery targets; a local volume is not an off-host backup. Never rely on an untested archive.

Restore **only to a new empty database**, then validate before switching traffic. The helper refuses system/nonempty databases, requires exact name confirmation, restores in one transaction and does not use `--clean`. Keep the existing production database intact. A restore is a recovery operation: switching traffic to an older snapshot loses all changes after that snapshot. Stop writes before final recovery/cutover.

```sh
docker compose --env-file .env.production -f compose.production.yaml exec -T postgres createdb -U platform_migrator platform_restore
docker compose --env-file .env.production -f compose.production.yaml cp ./release.dump postgres:/tmp/recovery.dump
docker compose --env-file .env.production -f compose.production.yaml exec -T -e PGDATABASE=platform_restore -e PGUSER=platform_migrator -e RESTORE_TARGET_CONFIRM=platform_restore postgres sh /operations/restore.sh /tmp/recovery.dump
```

Validate migrations, row counts, representative users/workspaces and the audit immutability trigger. Restore deliberately omits source ownership/ACLs. Connect to the restored database as its owner and grant `USAGE ON SCHEMA public`, `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public`, and `USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public` to `platform_app`; configure the same default privileges for future migrations as in `deploy/init-database.sh`. Keep the application role non-superuser with no schema CREATE privilege. Point both database URLs at the new database only after verification, run pending migrations, restart API/web and perform authenticated smoke checks. Do not bypass audit triggers to make a restore fit an existing database.

## Upgrade, rollback and shutdown

Use a deliberate maintenance window for this single-instance deployment. Record the current Git SHA/image digests; back up and verify that the new schema remains compatible with a rollback. Build new SHA-tagged images before stopping traffic. Stop web/API, then execute the new migration image explicitly. **On migration failure, do not restart the new API**: inspect safe migration status and repair with a reviewed procedure. Do not mark failed migrations as applied without confirming database state.

```sh
docker compose --env-file .env.production -f compose.production.yaml stop web api
docker compose --env-file .env.production -f compose.production.yaml run --rm migrate
# Only after exit code 0:
docker compose --env-file .env.production -f compose.production.yaml up -d --wait --force-recreate migrate api web
```

Rollback to recorded prior images only when they support the current schema. Prisma does not automatically reverse migrations. Otherwise recover into a new database from the verified backup, acknowledging the recovery point's data loss, then switch URLs and release together. Never run `migrate reset`, `migrate dev`, `db push`, or `down --volumes` against production.

`stop`/`start` retains containers and data; `down` removes containers/networks but keeps named volumes. `restart api` uses its existing image/config; configuration changes require `up -d --force-recreate api web`. SIGTERM drains for up to ten seconds; a nonzero exit and `shutdown_timeout` indicate interrupted work. Recheck readiness and refetch affected state.

## Common failures

- Startup configuration error: read the safe named setting, compare the template and do not print credential values.
- Migration failed/API absent: check database health, migration credentials, network and migration history; keep new traffic stopped.
- Readiness 503: check PostgreSQL health/connection saturation and API network. Disabled AI is unrelated.
- Login rejected/cookie missing: check exact HTTPS origin, edge Host/Origin forwarding, browser cookie attributes, clock and same-origin `/api` routing.
- Unexpected 429 for many users: confirm the host edge overwrites `X-Real-IP`; do not solve it by trusting arbitrary forwarded headers or raising auth limits.
- SSE disconnects: confirm no proxy buffering, heartbeat-compatible timeouts, single API replica and successful readiness.
- SMTP 503: check configured sender, verified TLS, credentials and provider status. No raw SMTP error is exposed; use the provider's authorized diagnostics.
- Docker engine unavailable: start the operator-managed engine. Repository scripts do not repair or reset the host.

Public infrastructure/TLS activation, SMTP provider acceptance, external monitoring, backup scheduling/off-host storage and operational ownership remain deployment-operator responsibilities.
