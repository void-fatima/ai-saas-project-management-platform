# Final core completion audit

Date: 2026-09-23. Branch: `feature/final-completion`, based on verified production milestone `1714f48da0cf293c336d7a3da5c793dc6114c98a`. The two authentication recovery stashes are preserved. This record concerns the implemented core, not a public production launch or every future roadmap capability.

## Findings and fixes

- A deleted or unavailable deep-linked subtask caused the entire parent dialog to fail. Only the nested child's 404 is now treated as unavailable; the authorized parent and other children remain usable. Other service errors still surface.
- A pending project deletion could navigate back to its old workspace after the user switched. Unmounted task/project mutations no longer invoke navigation or reload callbacks; late reloads cannot restart reads after unmount.
- Opening a new invitation while an earlier acceptance was pending reused the old view and could dismiss the new link. Invitation views are scoped to the authenticated user and token, aborting/ignoring the old response.
- Comment deletion lacked confirmation. It now uses the existing keyboard-accessible confirmation dialog, with cancellation and versioned server enforcement. Workspace deletion copy identifies the descendant data being removed.
- Disabled future navigation and a hardcoded development-environment control remained in the production shell. Navigation now exposes implemented destinations; the production decorative visual no longer advertises a developer action. Future capabilities remain in the roadmap.
- Local setup omitted migration deployment before startup. README and architecture/roadmap descriptions incorrectly deferred completed AI, reporting, audit and operations capabilities. Setup, CI coverage, current scope and future/provider classification now match the repository.
- The root Node engine accepted releases unsupported by the installed Vite/Prisma engines. The declared requirement now matches their intersection: Node 22.12+ within 22.x, or 24+.
- The TLS-edge example disabled raw access logs only in its HTTPS server. The HTTP redirect server now applies the same logging policy, so inherited access logs cannot capture arbitrary pre-redirect URLs.

Targeted component regressions cover these fixes. No backend permission rule, dependency, existing migration or database schema needed changing.

## Cross-route authorization review

All protected controllers use the existing session guard. Tenant services reuse `WorkspaceAccess` and current membership under the workspace transaction lock; no parallel authorization system was added. Client IDs are navigation/input only. Creation lists are authenticated-user scoped; invitation acceptance uses the opaque credential and matching recipient account before joining.

| Operation                                               | Owner                       | Admin                      | Manager | Member | Viewer |
| ------------------------------------------------------- | --------------------------- | -------------------------- | ------- | ------ | ------ |
| Workspace/member reads; dashboard/search; reports/CSV   | Yes                         | Yes                        | Yes     | Yes    | Yes    |
| Rename workspace                                        | Yes                         | Yes                        | No      | No     | No     |
| Invite, revoke, remove or change another non-owner role | Admin/Manager/Member/Viewer | Manager/Member/Viewer only | No      | No     | No     |
| Delete workspace                                        | Yes                         | No                         | No      | No     | No     |
| Leave workspace                                         | No                          | Yes                        | Yes     | Yes    | Yes    |
| Create/update/archive/restore/delete project            | Yes                         | Yes                        | Yes     | No     | No     |
| Create/edit/move root tasks and subtasks                | Yes                         | Yes                        | Yes     | Yes    | No     |
| Delete tasks or assign other members                    | Yes                         | Yes                        | Yes     | No     | No     |
| Self-assign unassigned work / clear own assignment      | Yes                         | Yes                        | Yes     | Yes    | No     |
| Create comments / edit-delete own comments              | Yes                         | Yes                        | Yes     | Yes    | No     |
| Generate AI / explicitly apply subtasks                 | Yes                         | Yes                        | Yes     | Yes    | No     |
| Read workspace audit                                    | Yes                         | Yes                        | No      | No     | No     |

Every row requires current membership in the requested workspace. Nobody can invite Owner, change their own role, demote/remove the Owner or transfer ownership. Archived projects reject task/comment/AI mutations; project administrators can still edit metadata, restore or delete them. Nobody can edit another author's comment. Notification reads and writes bind the authenticated recipient and current memberships. SSE derives subscriptions server-side, rechecks sessions/membership before protected hints, closes invalid sessions and repairs through REST. Foreign resource paths remain denied regardless of role.

Reviewed route families: auth and recovery; workspace/members/invitations; project/assignees; root and nested task CRUD/move; root and nested comments; activity; notifications; realtime; dashboard/search; project/root/nested AI; workspace/project analytics/report/CSV; audit; public liveness/readiness. Existing PostgreSQL role, tenant, archive, concurrency and revocation regressions cover the server boundaries.

## Data, security and user journeys

Reviewed the Prisma schema and all ten migrations together: composite workspace/project/parent/assignee and notification relationships, matching single-owner constraints, one-level immutable task parents, version/order invariants, assignment cleanup on departure, intentional descendant cascades, historical activity/AI identifiers, and non-cascading immutable audit rows. AI request reservations are durable and bounded. Current query paths bind tenant predicates; raw search/report SQL is parameterized. No speculative migration/index was added.

Security review covered Argon2id passwords; hashed expiring session/recovery/invitation tokens; session races/revocation; strict secure cookies; exact origin/CORS and Fetch Metadata policy; private proxy trust; body/rate limits; safe logs/errors; plain-text React output/local navigation URLs; CSV formula escaping; allowlisted audit metadata; bounded AI context, structured output and explicit reauthorization/apply. No concrete server-side authorization or tenant-query bypass was found. This is a repository review with automated regressions, not an external penetration test or a claim of unlimited capacity.

The five core journeys map to the browser suite and component/integration coverage: new user through persisted board/subtasks; invitation and collaboration through removed access; edited AI preview through normal subtasks; persisted reports/CSV and restricted audit; workspace switching with stale read/SSE/AI/search/report responses ignored. The final fixes add late mutation and invitation coverage. Major forms, loading/error/empty/disabled-provider states, keyboard controls, dialogs and destructive actions were inspected. The UI keeps drafts during hints and exposes authorized REST refresh as recovery.

Reviewed environment examples, strict TypeScript/build configs, package use, frozen-lockfile CI, Docker stages, proxy configuration, ignores, migrations and recovery runbook. No secret-bearing env file is committed or enters Docker contexts. Test-only AI is forbidden in production and the development panel is excluded from production output. No raw HTML, unsafe raw SQL or unfinished core TODO/debug endpoint was found.

## Final verification

| Check                          | Local result                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format, lint, strict typecheck | Passed; lint caught two request conversions in new test mocks, corrected before remaining checks                                                                                            |
| API unit/HTTP                  | 89 passed across 11 files                                                                                                                                                                   |
| Web components/hooks           | 126 passed across 15 files, including five new regressions                                                                                                                                  |
| PostgreSQL                     | 115 tests covered across nine files: 13 passed initially; seven suites hit 10-second setup timeouts while quality checks ran concurrently, then all their 102 tests passed with two workers |
| Real browser                   | Three Edge journeys passed, including auth/recovery, workspaces/RBAC, projects/subtasks/Kanban, collaboration, discovery, AI and reporting                                                  |
| Production builds              | API and web passed with `NODE_ENV=production`, `VITE_API_URL=/api`                                                                                                                          |
| Clean migrations               | All ten applied to a new empty disposable database; Prisma reported no difference                                                                                                           |
| Compose                        | Development and production configurations passed with existing `desktop-linux` context; no engine changes                                                                                   |
| Repository hygiene             | Diff whitespace and README/docs relative links checked; production JavaScript contains no developer panel/action or planned-navigation labels                                               |

The [Quality workflow](../../.github/workflows/quality.yml) runs on this final branch and additionally gates clean migration drift. Hosted results are authoritative for Docker API/web/migration image builds and the live production smoke (restricted role, migrations, proxy/cookies, backup/restore, database outage readiness, graceful SSE shutdown and disposable-stack cleanup). The final Git delivery report identifies the exact CI run and result; no unexecuted hosted result is asserted here. Local image/live Docker verification is not claimed because this execution environment cannot access the host Docker named pipe. Docker Desktop configuration is unchanged. No external SMTP/AI provider or public deployment is claimed verified.

## Remaining scope

The [roadmap classification](../roadmap/product-roadmap.md#final-audit-classification) preserves all approved future work. Richer task fields, drag-and-drop, preferences, advanced search/metrics, full AI project generation/RAG, scheduled/full-dataset reports, account-wide security audit and distributed scaling are future enhancements. Public TLS/domain, live SMTP/AI acceptance, off-host backups, operational monitoring/retention, host provisioning and deployment approval are provider/operator responsibilities. Portable deployment and recovery functionality are part of the tested core.
