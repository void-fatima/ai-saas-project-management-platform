# Projects / Tasks / Subtasks / Kanban verification

Work started from the verified workspace milestone `0b8ed14e7d5a1688f7ce25aefc2d285e26d34c57` on a new `feature/projects-tasks-kanban` branch. The original branch and both backup stashes are preserved. No main merge, force push, published history rewrite, production data, external mail, new dependency or deployment was used.

## Implemented contract

The [resource architecture contract](../architecture/projects-tasks.md) is the detailed source for data fields, API routes, tenant access, roles, assignment, subtasks and ordering. It preserves the [workspace governance contract](../architecture/workspace-tenancy.md).

- Workspace-scoped projects support create/read/edit/archive/restore/delete with deliberate cascading task/subtask deletion.
- Tasks and one-level subtasks support content, TODO/IN_PROGRESS/DONE, optional current-member assignment, creator attribution and versioned changes.
- Owner/Admin/Manager administer resources; Member edits/creates/moves and self-assigns only; Viewer reads only. Manager gains no workspace governance.
- `SessionAuthGuard` and the existing locked `WorkspaceAccess` resolve current membership, then scoped repositories verify every project/task/parent/anchor. Cross-tenant IDs return 404 independently of role or resource-ID knowledge.
- A composite membership FK prevents cross-workspace assignments. Removal/leave clears assignments and increments versions in the same transaction. Removed members lose subsequent access.
- Integer positions, serialized workspace transactions and required task versions protect reorder/content races. Stale writes return 409; partial movement failures roll back shifts.
- Every resource list is bounded to 50 rows with explicit next-page offsets. Assignee fields are limited to workspace-member ID, name and email.
- The interface provides project navigation/list/settings, archive/restore, a responsive board, task dialogs, assignees, subtasks, native keyboard movement and confirmed deletion. No optimistic success or drag-only interaction is claimed.

## Migration evidence

`20260919000000_projects_tasks` adds Project, Task and TaskStatus, composite project/parent/membership relationships, tenant-ordering indexes, positive-version/nonnegative-position checks, immutable one-level parent relationships and membership assignment cleanup. Earlier migrations were not modified.

All six migrations applied successfully from an empty native PostgreSQL 17 database named `platform_projects_migration_test_20260920` on the isolated loopback test cluster at port 55432. All 59 integration tests then passed against that new database. Existing disposable `platform_auth_test` also received the additive migration. No database reset was performed.

## Verification commands and results

Local environment: Windows PowerShell, Node 24, pinned pnpm 10.15.0, native PostgreSQL 17, installed Microsoft Edge. The pinned pnpm CLI was invoked through Node because pnpm was not globally available. Hosted CI uses Node 22, PostgreSQL 17 and Chromium. See [native PostgreSQL setup](../../README.md#postgresql-without-docker-windows) for equivalent environment and startup commands. Tests inject disposable connection values; no `.env` or credential file is committed.

Commands run for this milestone:

```text
pnpm exec prettier <changed source/docs> --write
pnpm --filter @platform/api prisma:generate
pnpm --filter @platform/api prisma:migrate:deploy
pnpm --filter @platform/api lint
pnpm --filter @platform/api typecheck
pnpm --filter @platform/api test
pnpm --filter @platform/api test:integration
pnpm --filter @platform/api build
pnpm --filter @platform/web lint
pnpm --filter @platform/web typecheck
pnpm --filter @platform/web test
pnpm --filter @platform/web build
pnpm --filter @platform/web test:e2e
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docker:config
git diff --check
```

| Check                                   | Actual local result                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| API unit/HTTP regressions               | 51 passed across seven files                                                                  |
| PostgreSQL integration                  | 59 passed across five files, including 18 new project tests                                   |
| Web unit/component/hook regressions     | 80 passed across ten files, including 12 new project tests                                    |
| Browser E2E                             | Three passed on Edge, including the expanded project/Kanban, Viewer and tenant-denial journey |
| Clean database migrations               | All six applied; all 59 integration tests passed against the fresh database                   |
| Root format, lint, strict typecheck     | Passed                                                                                        |
| API and web production builds           | Passed                                                                                        |
| Compose configuration / diff whitespace | Passed                                                                                        |

Browser verification caught select/textarea label matching issues after save and a test that attempted focus while controls were still disabled by an in-flight save. Labels now have explicit associations; keyboard assertions wait for the actual save to finish. The project dialog restores focus to a reloaded board card. Workspace navigation clears stale project/task URL preferences. Existing authentication and workspace behavior remains covered.

The project PostgreSQL suite has 18 tests covering the five-role real HTTP matrix (including subtask editing/deletion and privileged assignment), anonymous/non-member denial, hostile project/task/parent/anchor substitutions, dual memberships, Member assignment limits, cross-tenant assignment constraints, removal and leave cleanup, invalid database relationships, recursive/reparenting denial, archive/restore, task/project/workspace cascades, ordering persistence, concurrent writes, transaction rollback, bounded pagination, demotion, validation, CSRF and safe infrastructure errors. It runs alongside all 41 previous database tests.

The browser suite preserves the two original authentication journeys and expands the existing two-account workspace journey. The added helper creates a project and tasks, assigns the Owner, creates/completes a subtask, reorders and moves a card, reloads persisted state, checks modal keyboard behavior and mobile navigation, denies hostile direct API/UI access, then verifies Viewer read-only behavior and direct mutation denial. Existing invitation/Admin promotion/removal assertions remain. Reusing the two accounts avoids changing production registration rate limits or adding a second browser framework.

## Change inventory

- Persistence/server: Prisma schema and new migration; `apps/api/src/projects/` controller/module/schema/policy/service/repository; AppModule registration; the transaction-bound repository factory on WorkspaceScope.
- Interface: `apps/web/src/projects/` API parsing/request helper, data hook, project list/board/forms, task editor/details; App/Sidebar navigation; native dialog focus handling; responsive styles.
- Coverage: `apps/api/test/projects.integration.spec.ts`; project web component/hook tests; `apps/web/e2e/projects.journey.ts` and the expanded workspace browser test.
- Workflow/documentation: existing quality workflow branch trigger; README; architecture overview/workspace extension/resource contract; roadmap; this verification record.

## Deferred work

No realtime, comments/chat, notifications, AI, search platform, analytics/reports or audit/event infrastructure was implemented. Drag-and-drop, richer cross-page reorder controls, priorities, labels, due dates, attachments/history, milestones and project-specific members remain preserved in the roadmap. Workspace ownership transfer, invitation decline, custom roles, production mail delivery and deployment hardening remain deferred. Offset pages may shift under concurrent writes; refreshing reconciles them. Coarse workspace locking is intentional for this slice.

## Hosted CI and final status

Local verification passed. The final pushed commit's hosted CI run remains pending; this record does not yet claim milestone readiness.
