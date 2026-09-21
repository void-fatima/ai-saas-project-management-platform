# Dashboard / Search verification

## Scope and base

- Branch: `feature/dashboard-search`.
- Base: verified published Collaboration HEAD `8d04431e81da9c3ccdf3980841db1cf1f5ff8d45`.
- The previous branch and both authentication backup stashes remain unchanged.
- Contract: [dashboard and tenant-scoped search](../architecture/dashboard-search.md).
- No dependency, external service, production data, deployment, destructive migration, merge, history rewrite or force push.

## Local evidence — 2026-09-21

Windows, Node 24, pinned pnpm 10.15.0 invoked via its installed CLI, native PostgreSQL 17 on loopback, and Microsoft Edge through the existing Playwright Chromium framework. CI uses Node 22, hosted PostgreSQL 17 and Chromium. Only disposable databases are used.

| Command/check                                                                                                                | Observed result                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm lint`                                                                                                                  | Both packages passed                                                                       |
| `pnpm typecheck`                                                                                                             | Both strict TypeScript packages passed                                                     |
| `pnpm test`                                                                                                                  | API: 51 tests / 7 files; web: 95 tests / 12 files passed                                   |
| `pnpm build`                                                                                                                 | Nest API and Vite production builds passed; web JS 338.73 kB, gzip 98.76 kB                |
| `pnpm --filter @platform/api prisma:migrate:deploy`                                                                          | All eight migrations applied to newly created `platform_dashboard_migration_test_20260921` |
| `pnpm --filter @platform/api test:integration`                                                                               | 82 tests / 7 files passed against that clean migrated database                             |
| `pnpm --filter @platform/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | No difference detected; exit 0                                                             |
| `pnpm --filter @platform/web test:e2e` with `E2E_BROWSER_CHANNEL=msedge`                                                     | All three extended browser journeys passed                                                 |

`pnpm format:check` and `git diff --check` passed. Pushed CI evidence is recorded below. Local Docker was not required. The disposable local PostgreSQL cluster needed a restart before the clean-database check; the successful migration and complete integration run followed that restart. No database was reset or production service touched.

## Database, HTTP and query evidence

The nine new real PostgreSQL discovery cases cover active/archive project totals, root/subtask status counts, own-user outstanding assignments, bounded recent lists, historical activity, empty workspaces, foreign/removed memberships, title/description matches, normalization/casing, escaped wildcards/SQL input, plain snippets, exact/prefix/title/description ranking, deterministic ID ties, default/max pages, archive inclusion, deletion and rollback with no phantom state.

Actual Nest HTTP requests cover anonymous denial, Viewer access, foreign tenants, malformed UUIDs, strict/oversized/empty query parameters, bounded pages and generic safe errors on both endpoints. Empty queries do not bypass authorization. PostgreSQL regressions remain: persistence 2, sessions 11, recovery 8, workspaces 20, projects 18, collaboration/SSE 14, discovery 9 = 82.

An instrumented real Prisma client counts dashboard SELECTs with one and 201 tasks: unchanged and at most eight, independent of task count, excluding auth/lock/membership and transaction control. Activity actor names are batched. `EXPLAIN (ANALYZE, FORMAT JSON)` executes the parameterized ranked search and bounded recent-task shape; tests inspect tenant predicates/Limit and the new index definition. This is query-shape evidence on small fixtures, not a production load or latency benchmark.

Migration `20260921000000_dashboard_recent_tasks` adds only `tasks_workspace_id_updated_at_id_idx` on `(workspace_id, updated_at DESC, id DESC)`. All seven prior migrations are unchanged. Existing tenant, assignment and activity indexes remain. No text index/extension is added without demonstrated scale need.

## UI and browser evidence

Eight new dashboard/search web cases cover loading/populated/empty/error/retry, denied access clearing data, immediate scope masking, cancellation/late response rejection, duplicate/foreign/reconnect hints, one in-flight request, debounce, resource labels, text-only snippets, active-descendant/Arrow/Enter navigation, no results, archive inclusion, paging and encoded local links. A ninth new regression verifies an exact linked subtask outside the first child page. All previous 86 web tests remain.

The existing two-account workspace journey was extended without extra registrations or a second framework:

1. Real project/task/subtask state appears in dashboard counts and status rows.
2. A task created/deleted through the owner's cookie-backed API updates dashboard counts through actual SSE, without manual refresh or interception.
3. Project, task and subtask search selections open the correct persisted resources; task search also uses keyboard Enter and subtask navigation marks the exact selected child.
4. Switching to an empty workspace clears old dashboard/search results; selection survives reload; switching in the palette replaces the scope and removes prior results.
5. An outsider searches the private task title in their own workspace: both real HTTP and the UI return no results, with no resource disclosure.
6. Dashboard width remains usable at 360 px. Existing Auth, modal focus containment/restoration, invitations/roles/removal, Kanban and collaboration journeys pass.

## CI and completion

Capability commits:

- `8d98b55`: tenant-scoped dashboard/search API, additive recent-task index and PostgreSQL/HTTP/query coverage.
- `e4e5355`: persisted overview, keyboard search, safe freshness, exact subtask links and web/browser coverage.
- `6818cc7`: dashboard/search contract, roadmap, verification and CI branch coverage.

The [implementation CI run](https://github.com/void-fatima/ai-saas-project-management-platform/actions/runs/35629211480) passed on published commit `6818cc7295e573021bc9bce23bec30c53215d9c6`:

- `quality` (job `106431015810`): formatting, lint, strict types, API/web tests, production builds and Compose validation passed.
- `postgres-authentication` (job `106431016175`): clean PostgreSQL migrations, all 82 integration regressions, builds and the expanded Chromium browser journeys passed.

This evidence-only follow-up updates the report. The final handoff records its full HEAD and verifies its own pushed CI run; implementation code is unchanged. All implementation acceptance gates passed. No implementation blocker remains, and no subsequent milestone was started.

## Changed boundaries and deferred work

35 files changed: 10 API/schema/migration/test files, 18 web/component/browser files and 7 CI/README/architecture/roadmap/verification files. Main new files are `apps/api/src/discovery/`, its PostgreSQL/HTTP suite and additive index migration, plus `apps/web/src/discovery/` and `apps/web/e2e/discovery.journey.ts`. Existing changes wire the API module, replace the overview demo cards, implement command-palette search, add exact subtask navigation, preserve accessibility tests, extend CI and update contracts/roadmap/README. The unused static ActivityFeed and WorkspaceEcosystem components were removed. No authentication implementation, workspace role policy, dependency manifest/lockfile, earlier migration or `.env` changed. The test-owned PostgreSQL cluster was stopped after local verification.

AI, embeddings, semantic/vector search, RAG, advanced analytics, reports, full audit platform and external search engines remain explicitly deferred. Comments/user search, combined filters/saved views, dates/overdue metrics, richer workload summaries and representative-scale profiling remain in the roadmap. Search scans one workspace's text and offsets can shift under concurrent edits; workspace locks and the existing single-process SSE design retain their documented scale limits. No subsequent milestone starts automatically.
