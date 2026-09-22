# Reports, analytics and audit verification

Branch `feature/reports-analytics-audit`, based on verified AI Assistant commit `f0bf0f8c04524eaeaa37d636228d8c2f6a54a947`. Scope and definitions: [contract](../architecture/reports-analytics-audit.md).

Focused coverage includes real aggregates and UTC event semantics; Viewer report/export permission; Owner/Admin-only audit access; foreign IDs and removed memberships; CSV escaping/formula safety; strict query/metadata bounds; immutable SQL/public API behavior; transactional rollback; stable cursor pagination; fixed aggregate query count; UI range/export/filter/pagination/error states and stale-response cancellation. The browser journey extends existing authenticated work: approved subtasks appear in metrics/reports, CSV downloads, and the Owner finds the matching audit event.

Local verification completed on 2026-09-22 using repository-pinned pnpm, native PostgreSQL 17 on port 55432, and Microsoft Edge:

| Check                                       | Result                                              |
| ------------------------------------------- | --------------------------------------------------- |
| Formatting, API/web lint, strict typechecks | Passed                                              |
| API unit/HTTP tests                         | 66 passed, 9 files                                  |
| Web tests                                   | 115 passed, 14 files                                |
| PostgreSQL integration regressions          | 115 passed, 9 files                                 |
| Browser journeys                            | 3 passed, including analytics/report/CSV/audit flow |
| API and production web builds               | Passed                                              |
| Clean database migration validation         | All 10 migrations applied; no Prisma schema drift   |
| Compose configuration                       | Passed                                              |

Targeted tests ran during implementation; the full regression suites ran once near completion. Formatting and test-fixture/selector issues were corrected before the final successful checks. Immutable SQL mutation rejection and transaction rollback were exercised against PostgreSQL, and five aggregate queries were measured at both fixture sizes.

Tests use disposable PostgreSQL and existing deterministic AI fixtures; no external service calls are required. CI runs once after the complete branch is pushed; its exact commit/result/link is reported at delivery. No main merge, force push, backup-stash changes or new dependencies are part of this milestone.
