# Projects, Tasks and Kanban contract

This milestone extends the [workspace contract](workspace-tenancy.md). Workspace governance is unchanged; Manager has resource administration, never workspace administration.

| Role                  | Resource permissions                                                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner, Admin, Manager | Create/read/update/archive/restore/delete projects; create/read/update/delete/assign/move tasks and subtasks.                                                                                                                       |
| Member                | Read projects and boards; create and edit tasks/subtasks; move/reorder; self-assign an unassigned item and unassign themselves. Cannot replace another assignee, assign anyone else, administer projects, or delete tasks/subtasks. |
| Viewer                | Read projects, boards, task details and subtasks only.                                                                                                                                                                              |

## Persistence and lifecycle

`Project` belongs to a workspace, with a name (1–100 trimmed characters), description (up to 5,000), archived flag, nullable creator and timestamps. Names are not globally unique. Archiving preserves all data and makes task/subtask mutations return 409 until restored. Authorized project administrators can edit metadata, restore or permanently delete archived projects. Project deletion deliberately cascades all its tasks/subtasks; workspace deletion now cascades projects as well as memberships/invitations. Creator deletion clears attribution; it does not delete work.

`Task` has a title (1–200 trimmed characters), description (up to 10,000), status, integer position, optimistic version, optional assignee, creator and timestamps. A null `parentId` identifies a board task. A non-null parent identifies a one-level subtask, never another board card. Subtasks have the same content, status, assignment and resource policy as tasks. Completing a parent does not automatically complete its subtasks, or vice versa. Deleting a task cascades its subtasks.

Composite foreign keys require a task's workspace/project to match its project and parent. A database trigger requires parents to be root tasks and makes workspace/project/parent relationships immutable. Reparenting and recursive nesting are not supported. Task positions must be nonnegative and versions positive.

## Authorization and assignment

Every request uses `SessionAuthGuard` and `WorkspaceAccess.run(..., 'view', ...)`, which locks the workspace row and rechecks current membership. The callback binds a `ProjectScope` repository to that same transaction and workspace ID. It loads the project and, where applicable, the parent and task through explicitly scoped queries before applying resource capabilities. There are no global resource-ID authorization paths. Foreign or unavailable resources return 404; insufficient current role returns 403. Validation failures return 400; stale edits and archived task mutations return 409. Existing CSRF, no-store, rate-limit and safe-error middleware covers the nested routes.

An assignment references `(workspaceId, userId)` in current membership, independently enforced by a composite database foreign key. Authorized assignment checks run inside the workspace lock. Membership removal/leave clears assignments on both tasks and subtasks, increments affected versions, and updates timestamps in the same database transaction through a deletion trigger. Subsequent resource requests from the removed member fail. Requests already serialized before removal may finish, consistent with the existing workspace contract. Only member ID, name and email are returned for assignment options; password/session fields and unrelated users are never selected.

## Workflow and ordering

The supported statuses are `TODO`, `IN_PROGRESS`, `DONE`. Any transition among these three is allowed for an editable item. Custom workflows remain deferred.

Within a project, parent and status, cards sort by integer position, then UUID as a deterministic tie-breaker. Creation and status edits append to the destination. A move specifies destination status and `beforeId` (or null to append). It validates that anchor in the same tenant/project/parent/status, shifts positions at or after the anchor, then writes the moved card, all in the existing workspace transaction. Gaps left by moves/deletion are intentional and harmless; the next append uses the current maximum plus one. No unique-position constraint is necessary for intermediate shifts; application writes serialize under the lock and tests verify distinct final positions.

Task content updates and moves require the last observed `version`. Every task write, shifted position and cleared assignment increments it. A stale write returns 409 and changes nothing; the UI reloads current state and asks the user to review before retrying. A later failure rolls the entire shift/move back. This is deliberately coarse locking and optimistic conflict detection, with no realtime/CRDT infrastructure. Project metadata uses serialized last-write-wins updates.

## API

All routes below start with `/workspaces/:workspaceId/projects` and require an authenticated current workspace member:

| Suffix                                              | Methods / purpose                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| (none)                                              | GET paginated projects and permissions; POST project                                |
| `/assignees`                                        | GET paginated safe assignment options                                               |
| `/:projectId`                                       | GET project and permissions; PATCH metadata/archive; DELETE project and descendants |
| `/:projectId/tasks`                                 | GET paginated root tasks; POST task                                                 |
| `/:projectId/tasks/:taskId`                         | GET, PATCH, DELETE root task                                                        |
| `/:projectId/tasks/:taskId/move`                    | POST move/reorder                                                                   |
| `/:projectId/tasks/:parentId/subtasks`              | GET paginated subtasks; POST subtask                                                |
| `/:projectId/tasks/:parentId/subtasks/:taskId`      | GET, PATCH, DELETE subtask                                                          |
| `/:projectId/tasks/:parentId/subtasks/:taskId/move` | POST subtask move/reorder                                                           |

Lists return `{ items, nextOffset }`, at most 50 rows. `offset` is an integer from 0 through 1,000,000; task lists optionally filter `status`. Projects additionally return current permissions. Lists use stable ordering and bounded queries; offsets may shift under concurrent writes, so refreshing is the reconciliation mechanism. Each board column pages independently. No broad pagination framework or new dependency was introduced.

## Interface and deferred capabilities

Projects is reachable from desktop and mobile navigation. Workspace, project and root task URL parameters are preferences, never authorization. The UI provides server-backed project lists, settings, archive/restore/deletion confirmation, three Kanban columns, task details, assignment and subtasks. Native selects and buttons provide keyboard status changes, move-up within a loaded page and append-to-column controls. Native dialogs contain focus and restore it when their trigger remains mounted. The client cancels superseded reads, validates responses, bounds request duration, shows loading/empty/error states, and reloads after mutations without speculative success.

Subsequent [collaboration](collaboration-realtime.md) and [dashboard/search](dashboard-search.md) slices add comments, activity, notifications, SSE hints and workspace text search. A `subtask` URL parameter now selects an exact child through the existing authorized nested endpoint, including children beyond the loaded page. These parameters remain navigation preferences only. An unavailable linked child leaves its parent readable with an explicit message. Unmounted mutation flows cannot change the newly selected workspace. AI assistance and reporting/audit are implemented in their separate contracts.

Drag-and-drop, richer positioning across pages, broader realtime/collaboration, advanced search/analytics, priorities, labels, due dates, attachments, fuller task history, milestones and project-specific membership remain preserved in the roadmap.
