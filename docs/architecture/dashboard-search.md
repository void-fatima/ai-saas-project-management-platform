# Dashboard and workspace search contract

This is the minimal persisted dashboard and text-search slice. PostgreSQL is authoritative. No AI, analytics warehouse, cache, search service or new dependency is introduced. Workspace and resource RBAC guarantees remain unchanged.

## Authorization and API

Both endpoints require the existing session cookie and current workspace membership, including Viewer:

- `GET /workspaces/:workspaceId/dashboard`
- `GET /workspaces/:workspaceId/search?q=launch&limit=20&offset=0&includeArchived=false`

`SessionAuthGuard` authenticates the user; `WorkspaceAccess.run(..., 'view', ...)` locks the workspace and reloads membership; the discovery repositories bind the transaction and workspace ID. Removal and reads serialize through the existing workspace lock. A missing/foreign/removed workspace returns the same 404. Even an empty search checks membership. Possession of a search result or historical activity ID grants no access: resource navigation uses the normal authorized project/task endpoints again.

Every project/task/activity query includes the workspace predicate in PostgreSQL. The search UNION scopes both arms and its task/project join before matching; no globally found IDs are filtered in Node. Counts and snippets never include another workspace. Existing no-store responses, origin/fetch-metadata policy, throttling and safe error handling apply. UUIDs and query input are validated before domain reads; unknown query fields are rejected. Anonymous requests return 401, malformed input 400, throttling 429, and unexpected failures a generic 500 without SQL details.

## Dashboard DTO and aggregation semantics

| Field          | Definition                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `workspaceId`  | Authorized workspace, also checked against the client request scope                             |
| `projects`     | `{ total, active, archived }`, including all current projects in this workspace                 |
| `tasks`        | `{ total, TODO, IN_PROGRESS, DONE }` for root tasks in active projects                          |
| `subtasks`     | Same counts for one-level subtasks in active projects, independently of parent status           |
| `assignedToMe` | `{ total, items }` for this authenticated user's non-DONE roots and subtasks in active projects |
| `recentTasks`  | Most recently updated roots and subtasks in active projects                                     |
| `activity`     | Most recent workspace activity, including history for archived/deleted resources                |

Each list has at most eight items. Task summaries select only `id`, `projectId`, `parentId`, `title`, `status`, `updatedAt`; ordered by `updatedAt DESC, id DESC`. Activity reuses the safe collaboration projection and orders by `createdAt DESC, id DESC`. Historical links can legitimately become unavailable after deletion. User names in activity are historical actors, not a membership directory. Passwords, tokens, emails and notification internals are absent.

Completion is displayed as DONE roots / total roots and DONE subtasks / total subtasks. A completed subtask does not mark its parent done; subtasks do not inflate root completion. Zero work is an empty state, not a fabricated productivity score. Archived projects count in project totals but their tasks do not contribute to current workload. Unread counts remain in the existing own-user notification bell. Due dates, overdue work, project health and productivity scoring remain deferred. The separate reports module implements workload analysis and daily activity trends; these are not dashboard backlog history.

Dashboard reads use seven fixed Prisma operations: project grouping, two status groupings, assignment count, two bounded task lists, and bounded activity. Prisma may add one batched actor-name query. Tests measure SELECT count on a real instrumented Prisma client at one and 201 tasks: the count is unchanged and at most eight, excluding session authorization, workspace lock/membership and transaction control. No per-task/project/member query is issued; Node receives aggregate rows and bounded lists only.

## Search input and matching

- Scope: project names/descriptions and task/subtask titles/descriptions. Comments are deliberately deferred: useful comment search also needs focused discussion navigation and deleted-comment semantics. It is not silently included through activity or notifications.
- Trim query edges and collapse whitespace to one space. At most 200 raw characters and 100 normalized characters; nonempty queries need at least two characters. Missing/empty/whitespace-only query returns `{ items: [], nextOffset: null }` after authorization. One normalized character is rejected.
- Normalize stored text whitespace for matching and use PostgreSQL case-insensitive literal substring matching. `%`, `_` and backslash are escaped, not wildcards. No stemming, fuzzy matching, accent folding, semantic matching or relevance-quality claim is made; casing follows PostgreSQL's collation behavior.
- Search active projects by default. `includeArchived=true` includes archived projects and their tasks, each labeled `archived`. Deleted projects/tasks/subtasks are absent; activity history is not searched.
- Default limit 20, allowed integer range 1–50. Offset is an integer 0–10,000. Read at most `limit + 1` matching rows and expose `{ items, nextOffset }`; no total match count. `nextOffset` becomes null at the end or the offset ceiling. The UI pages in steps of 20.
- Ordering: exact normalized title, prefix title, other title substring, then description-only match; ties use `updatedAt DESC, id ASC, kind ASC`. Offset pages are deterministic for unchanged data. Concurrent edits may move results between pages; refreshing reconciles them. This is not snapshot pagination.

The safe result projection is `{ kind, id, projectId, parentId, title, snippet, status, archived, updatedAt }`, where kind is PROJECT/TASK/SUBTASK, project status and parentId are null, and snippet is the first 160 characters of description. Snippets are plain text and may not contain the matching phrase when it occurs later in a long description. All text is rendered by React without raw HTML. Navigation builds a local URL with `URLSearchParams`, then loads the persisted resource normally. Subtasks link to `task=<parent>&subtask=<child>`; the details dialog fetches that exact nested child even if it is outside the current subtask page and labels it Selected subtask.

Prisma handles ordinary aggregates and lists. Search uses a single parameterized `Prisma.sql` / `$queryRaw` statement because one UNION with global cross-kind ranking/pagination is simpler and more accurate than independently paging projects and tasks in Node. All values, including escaped query text, workspace ID, archive switch and limits are bound parameters. No unsafe raw-query API is used.

## Indexes and scale limits

Additive migration `20260921000000_dashboard_recent_tasks` adds only `tasks(workspace_id, updated_at DESC, id DESC)`, matching the concrete bounded recent-task ordering. Existing project/task workspace-prefix indexes support tenant candidate selection, the assignment index supports own-user filtering, and the activity workspace/time index supports history. Existing migrations and tenant constraints are unchanged.

Integration tests execute `EXPLAIN (ANALYZE, FORMAT JSON)` for ranked search and bounded recent tasks and verify the new index definition. Small fixtures may use sequential scans; no forced-plan or production latency claim is made. Search scans/normalizes text within one authorized workspace and performs a bounded top sort; it is linear in that workspace's candidate text. Aggregates also inspect that workspace's active workload. The shared workspace lock serializes reads and mutations, so large workspaces/expensive searches can contend. Deep offsets add work and are capped. This is adequate for the current slice, not evidence for unlimited scale. Profile representative workloads before adopting PostgreSQL full-text/trigram indexes, separate read snapshots, cursors or a justified cache. No external engine is required here.

## Frontend freshness and accessibility

Overview uses a workspace selector and persisted cards/status table, assignments, recent tasks and activity. Demo activity, synthetic verification cards and the planned ecosystem diagram were removed. The purple visual identity remains decorative; service status is labeled API readiness and comes from the real health request. No AI runtime health or CI claim remains in the dashboard.

The existing command palette provides workspace selection, search, archive inclusion and paging. Empty input offers actual system/project commands. Search waits 250 ms after input changes; obsolete requests are aborted. Requests have a ten-second timeout. Scope keys mask old data immediately on workspace/query changes even before effect cleanup; aborted late responses cannot update the new scope. Closed dialogs unmount and cancel reads. Dashboard failure/removal clears old data and exposes retry; loading, empty and unavailable states are explicit.

Existing SSE delivers refresh hints only. Workspace hints are filtered; duplicates coalesce for 150 ms. A discovery scope allows one in-flight request; manual refreshes coalesce and hints during a read queue at most one trailing repair read. A hint during search debounce waits for the scheduled read. Reconnect-ready and visibility restoration repair missed hints by reading REST again. No polling, durable client cache, streamed metrics or full-state SSE payload is added. Existing single-process realtime limitations remain unchanged.

Dashboard refresh does not move focus. Counts and statuses are text/table semantics, not color alone. The command input remains a combobox with listbox options and an active descendant; Arrow keys select, Enter activates, Escape closes, native dialog focus is contained and restored. Results are labeled Project/Task/Subtask and announced once per completed page. Selectors, actions and layout remain usable at 360 px width.

## Deferred scope

Basic AI assistance, deterministic reports/analytics and workspace audit are implemented in their separate contracts. Full AI project generation, embeddings, semantic/vector search, RAG, advanced analytics, account-wide security audit and external search engines remain deferred. The roadmap also preserves overdue work once dates exist, richer project/workload summaries, appropriate-user/comment search, combined assignee/status/priority/deadline filters, saved views, larger-scale query budgets and cursor/search-index evaluation. This milestone authorizes none of those follow-ups automatically.
