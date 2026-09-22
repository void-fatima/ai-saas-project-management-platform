# Collaboration, notifications and realtime contract

This milestone extends the [workspace contract](workspace-tenancy.md) and [project/task contract](projects-tasks.md). Their ownership, role, archive and tenant guarantees remain unchanged. Activity is user-visible product history, not a security audit log.

## Persistence and transactions

Migration `20260920000000_collaboration` adds `TaskComment`, `Activity`, `Notification`, `ActivityType` and `NotificationType`. It is additive; existing migrations and custom owner/subtask/assignment constraints are unchanged. There is no new package dependency or infrastructure service.

- `TaskComment` has an exact composite workspace/project/task foreign key, author, body, request ID, version and timestamps. Plain text is trimmed, nonempty, limited to 4,000 characters and rendered as React text. No HTML, rich text, mention parsing or implicit user references.
- `Activity` has a workspace foreign key, nullable actor, typed action, project/task/root-task references, safe subject title, optional status transition, deduplication key and creation time. Public DTOs select actor name only. Comment bodies, arbitrary request JSON, credentials and email addresses are never activity metadata.
- Activity resource IDs deliberately are historical references without live resource foreign keys. Task/project deletion preserves history; workspace deletion cascades it. Every history read still checks current workspace membership. References never grant access to a resource.
- `Notification` belongs to a current workspace membership and a same-workspace activity through composite foreign keys. Membership removal deletes that user's notifications for the workspace. Activity/recipient uniqueness prevents duplicate fan-out.
- Domain writes, activity and notification fan-out share the existing workspace-locked PostgreSQL transaction. A transaction failure rolls back all three. Workspace invalidation is published only after successful commit. Reads do not publish hints.

Comment creation requires a client UUID `requestId`, unique per workspace/author. Concurrent identical retries return the existing comment without another activity or notification. Reusing that ID for a different body/task, or after deletion, returns 409. Edits/deletes require the current positive integer `version`; stale writes return 409. A delete clears the body and sets `deletedAt`, preserving the request ID so a delayed retry cannot resurrect the comment. Task/project deletion cascades comments. User deletion sets authors/actors null; UI shows “Former user.”

## Permissions

| Role                          | Read comments/history        | Create comments         | Edit/delete comments |
| ----------------------------- | ---------------------------- | ----------------------- | -------------------- |
| Owner, Admin, Manager, Member | Current workspace membership | Yes, on active projects | Own comments only    |
| Viewer                        | Current workspace membership | No                      | No                   |

Archived projects are read-only for all comment mutations. An author who becomes Viewer loses mutation permission. Higher roles have no arbitrary editing/moderation right over another author's text. Root tasks and correctly nested subtasks use the same rules. An incorrect tenant, project or parent path returns 404; denied role actions return 403. The backend enforces every rule independently of the UI.

## Activity and notification mapping

| Action                                                            | Durable activity                      | Notification                                                     |
| ----------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| Project create, name/description change, archive, restore, delete | Corresponding typed project action    | None                                                             |
| Task/subtask create                                               | `TASK_CREATED`                        | Separate assignment event when assigned                          |
| Task/subtask title/description change                             | `TASK_UPDATED`                        | None                                                             |
| Task/subtask status change                                        | `TASK_STATUS_CHANGED`, old/new status | None                                                             |
| Explicit assignment/unassignment                                  | `TASK_ASSIGNED`                       | New assignee, if present and different from actor                |
| Task/subtask delete                                               | `TASK_DELETED`                        | None                                                             |
| Comment create                                                    | `COMMENT_CREATED`                     | Current task creator and assignee, deduplicated, excluding actor |
| Own comment edit/delete                                           | `COMMENT_UPDATED` / `COMMENT_DELETED` | None                                                             |
| Reorder without status change                                     | Refresh hint only                     | None                                                             |

No-op content changes do not create activity or notifications. One task edit can produce separate content/status/assignment events. Task event keys include task ID, resulting version and type; comment keys include comment ID/version. Notification recipients are rechecked against current memberships inside the same workspace lock. At most two recipients receive a comment notification. Membership/invitation history now uses the separate [audit ledger](reports-analytics-audit.md). Per-task automatic assignment cleanup history remains deferred; membership removal clears assignments through the existing database trigger and publishes a refresh hint.

## HTTP routes and bounded reads

All routes require the existing session cookie. UUIDs, strict request shapes and pagination are validated. Responses have `Cache-Control: no-store` and existing same-site/origin protections; SSE does not relax cookies or CORS.

| Method                | Route                                                                        | Contract                                                            |
| --------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| GET                   | `/workspaces/:w/projects/:p/tasks/:t/comments`                               | Comments page and current `canComment`                              |
| POST                  | Same                                                                         | `{ body, requestId }`                                               |
| PATCH                 | Same + `/:commentId`                                                         | `{ body, version }`; own author only                                |
| DELETE                | Same + `/:commentId`                                                         | JSON `{ version }`; 204                                             |
| GET/POST/PATCH/DELETE | `/workspaces/:w/projects/:p/tasks/:parent/subtasks/:t/comments[/:commentId]` | Equivalent subtask operations, exact parent validation              |
| GET                   | `/workspaces/:w/activity`                                                    | Optional `projectId`, `taskId`; task filter requires project filter |
| GET                   | `/notifications`                                                             | Own inbox page and own global `unreadCount`                         |
| PATCH                 | `/notifications/:id/read`                                                    | Own, currently accessible notification; idempotent 204              |
| POST                  | `/notifications/read-all`                                                    | Own current memberships only; idempotent 204                        |
| GET                   | `/realtime`                                                                  | Authenticated SSE connection, no client-selected subscriptions      |

Lists return at most 50 `items` and a nullable `nextOffset`. `offset` is an integer from 0 to 1,000,000; order is newest-first `(createdAt, id)`. Like existing project pagination, pages are not a frozen snapshot across requests: new writes may shift offsets. Refresh the first page to recover current state. Inbox rows/count are read in one repeatable-read transaction. Repeated mark-read requests preserve the first `readAt` timestamp.

History filters are scoped historical-ID filters; missing/foreign resource IDs return no matching history inside an otherwise accessible workspace. A foreign workspace itself returns 404. Notification lookup/update always includes the current recipient. Stale task/project links encounter the normal authorized resource lookup and may return 404. The UI never treats a notification as an access grant.

## SSE choice, authorization and lifecycle

Traffic is server-to-browser invalidation, so native SSE is sufficient. There is no bidirectional editing, WebSocket dependency, Redis or background worker. REST/PostgreSQL remain authoritative.

Each browser shell opens one credentialed `/realtime` stream. The normal session guard authenticates the handshake and can rotate the cookie. The connection retains user/session IDs, never a raw token. Subsequent session rotation does not invalidate the session ID. The server derives memberships; browser-selected workspace IDs cannot subscribe to foreign tenants.

Workspace commit → in-process hint → acquire that workspace's existing lock → batch-load all connected session IDs and memberships → emit only to active sessions with current membership. The lock serializes protected hints with membership removal. No protected workspace hint can be emitted after removal commits. A previously known workspace may receive `workspace-access-ended` so cached UI can refetch; outsiders never receive its ID. Deleted workspaces use the same access-ended behavior.

Before protected delivery, sessions must be unrevoked and within both database expiry and configured absolute lifetime. A 15-second authorization heartbeat also checks idle streams using one batched query, with no per-client query loop. Invalid connections receive `session-ended` and close; the UI refreshes the existing session state. No protected hints are delivered while invalid, even before the next heartbeat. Database/delivery failures close connections and log only a static warning.

Named events: `ready`, `workspace-changed` (`{workspaceId}`), `workspace-access-ended` (`{workspaceId}`), `notifications-changed` (own user only), `heartbeat`, `session-ended`. No domain body, notification text, actor, task or comment payload is broadcast. Connection limits are five per user and 1,000 per process, checked again after asynchronous authentication. The pending hint map is capped at 1,000 keys. Backpressured streams close instead of accumulating unbounded buffers. Disconnect and module shutdown remove streams, timers and subscriptions.

## Delivery, reconnection and frontend behavior

Delivery is best effort, not exactly once. A process crash between commit and publish may lose a hint; persisted activity and notifications remain intact. SSE does not replay `Last-Event-ID`; it sends no sequence claims. Duplicate/out-of-order hints are harmless because they trigger current-state reads, coalesced over 150 ms. Superseded requests are aborted/ignored. Native EventSource reconnects (server retry hint: three seconds); every `ready` and return to a visible tab refetches persisted collaboration/inbox state. There is no periodic domain-data polling.

Task details show plain-text comments and activity, with author/time, pagination and manual refresh. Comment drafts remain mounted during successful background refreshes. The first UI surface is root task details; subtask discussion routes are available, while a dedicated subtask discussion surface is deferred. Project activity is available in an expandable panel. Task editors/boards show a refresh notice on hints instead of overwriting drafts or removing a focused card. Manual task/board refresh intentionally reloads current data. Notifications provide an accessible unread label, read/read-all, ordinary related-resource links, native modal keyboard containment and focus restoration.

The notification panel reports live/degraded status and offers “Refresh and reconnect.” REST workflows and manual refresh remain available without SSE. Existing session focus/visibility recovery remains in place. Background changes do not move focus; live announcements are limited to the update notice and open notification count.

## Limits and preserved follow-ups

This transport is for one API process. Multiple replicas require shared post-commit pub/sub with the same server-side authorization checks; a durable outbox may be justified for stronger delivery requirements. Neither is needed for this slice. Reverse proxies must permit long-lived responses, disable SSE buffering and use timeouts compatible with the heartbeat. Process-local rate limits retain their existing deployment limitations. Load/capacity testing, retention/archiving, large-history cursor pagination and richer notification preferences remain hardening work.

Mentions, sanitized rich text, attachment handling, subtask discussion UI, notification email/digest/deadline/preferences, broader member/invitation history, full audit/event platform, chat, presence, coediting, AI, advanced search, analytics and reporting remain in the roadmap. None is implied by this milestone.
