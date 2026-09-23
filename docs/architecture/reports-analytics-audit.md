# Reports, analytics and audit contract

This slice adds deterministic workspace/project analytics, paginated JSON/CSV reports, and a separate immutable workspace audit trail. It reuses the NestJS modular monolith, PostgreSQL, session authentication and workspace-locked authorization. No dependency, AI capability, scheduler, warehouse or deployment infrastructure is added.

## Reads and metric definitions

All current workspace members, including Viewer, may read/export. Removed membership and foreign project IDs return 404. Every query is bound to the authorized workspace transaction; project reads first validate that exact project through `ProjectScope`.

| Endpoint under `/workspaces/:workspaceId`                       | Query / behavior                               |
| --------------------------------------------------------------- | ---------------------------------------------- |
| `/analytics`, `/report`                                         | `range=7d\|30d\|90d` (default 30d), `offset=0` |
| `/projects/:projectId/analytics`, `/projects/:projectId/report` | Same, with project scope                       |
| `/report.csv`, `/projects/:projectId/report.csv`                | Same report page, CSV download                 |
| `/audit`                                                        | Owner/Admin only; filters and cursor below     |

Current status/assignment counts include all surviving projects/tasks, including archived projects. Roots and subtasks have separate totals/status distributions. Completion is `DONE / total * 100`, rounded to one decimal; no work yields 0%. Workload lists current member IDs/names plus an unassigned row, separating root/subtask counts and combined open/done counts. Names are current display names, not audit identities or productivity scores.

The range applies to daily UTC activity trends, including the current UTC day: task/subtask creation events, transitions into DONE, and all existing Activity events. Reopening and completing the same task twice produces two completion events. Trends can retain events for deleted tasks while current totals exclude them. This is event throughput, not a historical backlog snapshot or a count of unique completed tasks. Gaps are zero-filled. Existing Activity retention/deletion semantics remain unchanged; no historical events are invented or backfilled.

The workspace repository uses five fixed aggregate/page queries, with one additional scoped project lookup for project reads. Tests compare query counts with 0/200 extra tasks. Existing task/activity indexes support these paths; this slice adds only the audit deduplication and tenant/time/ID indexes. Realistic production-scale latency budgets, query-plan tuning and warehouse/materialized summaries remain later hardening.

Project/member rows are limited to 50 each per page, with a shared offset and explicit `nextOffset`. Offset is bounded at 1,000,000. Totals and daily trends cover the full scope on every page. CSV intentionally exports the displayed report page, includes page/next-offset metadata, and does not silently claim a full roster export. Reports are generated from current persisted state, not stored snapshots; refreshing a report may reflect subsequent mutations. All reads are non-cacheable and do not generate audit events.

CSV uses CRLF rows and double-quoted cells with escaped quotes. Spreadsheet formulas, including whitespace/control-prefixed `=`, `+`, `-`, `@`, and leading tabs/newlines, are neutralized with a text prefix. Filenames are fixed `workspace-report.csv` / `project-report.csv`; user names never enter Content-Disposition. JSON and CSV use the same aggregate result.

## Audit contract

`AuditWriter` accepts only server-defined action/entity enums and strict metadata keys. Events contain tenant/actor/entity UUIDs, action, entity type, database timestamp, safe status/role/assignment/version/count metadata, and a private deduplication key. No names, email addresses, task/project titles/descriptions, comments, credentials, request bodies or AI content are copied into audit metadata. IDs remain historical identifiers, not access grants. The UI presents actor IDs (or System), exact event times, actions and safe deltas as plain text.

Covered mutations: workspace create/rename/delete; invitation issue/reissue, revoke, accept and delivery-failure invalidation; member role changes/removal/leave; project create/update/archive/restore/delete; root/subtask create/content/status/assignment/delete; reordering; comment create/edit/delete; explicit AI-breakdown apply. Domain, Activity/notifications where applicable, and audit insertion share a transaction. Replayed comments, task activity and AI apply do not duplicate audit events. No-op content/role/rename operations do not add audit noise. Existing Activity contents and notification behavior are unchanged.

Events describe explicit commands, not every cascading row effect. Parent/project deletion records the command target; automatic assignment cleanup remains attributable to the member-removal/leave command rather than a per-task fan-out. That finer history is preserved as deferred work. Global login/session/password-recovery events also remain deferred: identity transactions have no single workspace context, and copying them into tenants would require an explicit privacy/transaction design.

`AuditEvent` has no cascading resource/user/workspace foreign keys. Workspace deletion writes its audit event before deleting the workspace; historical rows survive, but cannot be read through application APIs once the workspace and membership boundary is gone. Actor deletion cannot rewrite past events. PostgreSQL rejects UPDATE, DELETE and TRUNCATE with an immutability trigger; public APIs expose only GET. This protects normal application flows, not a privileged database administrator who can alter schema/triggers. It is not a cryptographic tamper-proof compliance claim.

Audit reads require current Owner/Admin membership, independently of frontend visibility. Filters are `action`, `entityType`, `actorUserId`, inclusive UTC `from`/`to` dates (maximum 90 days; default last 30 days), `limit=1..100` (default 50), and `cursor`. Ordering is `(createdAt DESC, id DESC)` with keyset pagination, so new inserts do not shift later pages. Unsupported filters and malformed/big cursors fail validation. Each page rechecks authorization; metadata and tombstones never bypass tenancy.

Audit history starts when migration `20260922010000_reporting_audit` is applied. Automatic retention/deletion, tenant export of tombstones, audit partitioning, privileged retention procedures, broader account-security event coverage and regulated retention decisions remain deferred. No ordinary application cleanup deletes this history; retention must be designed explicitly before production rollout.

## UI and deferred scope

The authenticated sidebar opens Analytics and reports with workspace selection, range controls, status/workload/trend tables, project reports, current-page CSV download and Owner/Admin audit filters/pagination. Loading/errors/empty states, explicit refresh, export duplicate guards and scoped cancellation protect workspace/project changes. Existing workflows stay intact.

AI/scheduled reports, full-dataset exports/PDF, report snapshots, due-date/overdue metrics, cycle/lead time, risk scoring, per-task cascade audit fan-out, account-wide security audit, vendor monitoring and RAG/vector work remain on the roadmap. Portable production operations are implemented in the operations contract.
