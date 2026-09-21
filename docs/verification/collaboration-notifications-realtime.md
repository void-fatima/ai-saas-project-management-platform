# Collaboration / Notifications / Realtime verification

## Scope and base

- Branch: `feature/collaboration-notifications-realtime`.
- Base: published Projects HEAD `b4adf30cf774b0c864c67e20c5c00b2cad085aac`.
- The previous branch and both authentication backup stashes remain unchanged.
- Contract: [collaboration and realtime](../architecture/collaboration-realtime.md).
- No dependency added; no Docker required locally, production data, deployment, force push, merge or history rewrite.

## Local evidence — 2026-09-20

Windows, Node 24, pinned pnpm 10.15.0 invoked through its installed CLI, native PostgreSQL 17 on loopback, and Edge through the existing Playwright Chromium framework. Tests use disposable databases only. CI uses Node 22, hosted PostgreSQL 17 and Playwright Chromium.

| Check                                                                    | Observed result                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `pnpm format:check`                                                      | Passed                                                        |
| `pnpm lint`                                                              | API and web passed                                            |
| `pnpm typecheck`                                                         | API and web passed                                            |
| `pnpm test`                                                              | API: 51 tests / 7 files; web: 86 tests / 11 files, all passed |
| `pnpm --filter @platform/api test:integration`                           | 73 tests / 6 files, all passed                                |
| API and web production builds                                            | Passed                                                        |
| `pnpm --filter @platform/web test:e2e` with `E2E_BROWSER_CHANNEL=msedge` | 3 real-browser journeys passed                                |
| Fresh database migrate deploy and status                                 | All 7 migrations applied; schema up to date                   |
| `git diff --check`                                                       | Passed                                                        |

Final backend review was followed by API lint, typecheck, the full 73-test PostgreSQL suite and both builds. The test-environment web build also passed; the normal build was separately run without `NODE_ENV=test`. Static generic error output in injected-failure tests is expected and contains no exception details or credentials. Local Docker Compose validation was not run; the existing CI quality job validates it.

## Database and HTTP evidence

The new suite has 14 tests, using actual Nest HTTP, services and PostgreSQL. Previous suites remain: database 2, session lifecycle 11, recovery 8, workspace 20, projects 18.

- Concurrent identical comment requests produce one comment/activity/notification fan-out; plain-text bodies and safe DTOs are preserved.
- Anonymous requests, malformed body/request UUID/pagination, Viewer mutations, cross-workspace IDs and mismatched parent paths are denied.
- Owners cannot edit/delete another author's comment. Author edits use optimistic versions; soft deletion clears text and prevents request-ID resurrection. Archived project mutation is denied.
- An injected failure after real transactional activity/notification writes rolls back comments and task status, leaves no false durable records and emits no post-commit signal. HTTP returns a generic 500 without the injected error detail.
- Meaningful project/task transitions persist typed activity; same-assignee/reorder operations do not produce notification spam.
- Inbox recipient isolation, stable mark-read, read-all/unread count, bounded comments/activity/inbox pages, CSRF policy and harmless deleted-task links are covered.

Migration `20260920000000_collaboration` adds three tables and two enums, with composite tenant foreign keys and deduplication/read indexes. It applied both to the existing disposable regression database and from empty state in `platform_collaboration_migration_test_20260920`. All previous migrations and database triggers were retained.

## Realtime evidence

The integration suite opens real TCP HTTP SSE streams, parses frames and uses explicit frame waits plus a server delivery barrier/heartbeat. It does not rely on fixed sleeps.

- Authenticated Viewer receives committed workspace hints; a foreign workspace user receives neither that workspace ID nor its hints.
- Reconnect returns `ready`; REST recovers the persisted comment and unread count.
- Mark-read invalidation is recipient-only; the sixth simultaneous connection for one user gets 429.
- Removal through the real workspace HTTP route sends access-ended, deletes the recipient's notifications, denies subsequent REST access and prevents later protected hints.
- Revoked, expired and absolute-lifetime-expired sessions receive session-ended before any protected delivery and cannot reconnect.

No exactly-once, cross-replica delivery or load-test claim is made. Single-process invalidation, post-commit loss window, bounded connection/backpressure handling and scaling requirements are documented in the contract.

## Frontend and browser evidence

Six new web tests cover safe text rendering, author/Viewer controls, comment retry ID reuse, draft/focus preservation on hints, unread/read/navigation and modal focus restoration, plus EventSource reconnect, degraded state and cleanup. Existing 80 web tests remain passing. The project fixture now supplies the real activity response shape.

The existing two-account workspace/project browser journey was extended without a second E2E framework or extra registration burst. It verifies:

1. A foreign workspace user's real browser SSE stream receives no private-team hint through a transport heartbeat; private comments and notifications remain inaccessible.
2. Owner assigns a task to the invited member. Both open details; a new owner comment appears in the member's view while its focused draft survives.
3. Member replies, the owner's view updates, unread notifications appear, mark-all-read persists, and dialog close restores trigger focus.
4. Reload retains comments/activity. After demotion, Viewer reads both but cannot submit/edit comments, including a direct HTTP mutation attempt.
5. Previous Auth, invitation/removal, Projects/Kanban, mobile width, sidebar and keyboard assertions still pass.

The added dialog controls required updating the existing last-focusable-button assertion. Browser validation also exposed background refresh disabling that button; controls now remain enabled during background reads with existing data, preserving focus. The full suite then passed.

## CI and completion

The [implementation CI run](https://github.com/void-fatima/ai-saas-project-management-platform/actions/runs/35515574527) passed on published commit `bc0c11e57b95af1d7c4adfbecf76f0b225b95b5c`:

- `quality` (job `106090831133`): formatting, lint, typecheck, API/web tests, builds and Docker Compose validation passed.
- `postgres-authentication` (job `106090831024`): all migrations on fresh PostgreSQL, all regression suites, builds and Chromium browser journeys passed.

Capability commits:

- `b4db22f`: transactional persistence, activity/notification lifecycle, authorized SSE and PostgreSQL/HTTP/transport tests.
- `4725142`: collaboration UI, realtime refresh behavior, component and browser coverage.
- `bc0c11e`: contract, roadmap, verification and CI branch coverage.

The evidence-only follow-up changes this report. The handoff records its full final HEAD and verifies its own pushed CI run; the implementation tested above is unchanged. All implementation acceptance gates passed. No implementation blocker remains, and no next milestone was started.

## Files changed

39 files changed across this milestone: 18 API/schema/migration/test files, 15 frontend/component/browser files, and 6 CI/README/architecture/roadmap/verification files. The main new boundaries are `apps/api/src/collaboration/` and `apps/web/src/collaboration/`. Existing edits are limited to wiring the modules, post-commit workspace signals, project activity writes, HTTP protections, task/board/shell UI, relevant fixtures/journeys, styles, CI and documentation. No `.env`, dependency lockfile, older migration, authentication implementation or workspace role-policy file changed.

## Deferred work

Mentions/rich text/attachments, dedicated subtask discussion UI, preferences/digests/email/deadline notifications, broader membership/invitation/automatic assignment-cleanup history, full audit/event platform, chat, presence, coediting, shared pub/sub/outbox/replay, retention/cursor/load hardening, AI, advanced search, analytics and reporting remain preserved in the roadmap. Production email and all previously deferred hardening remain unchanged. No later milestone was started.
