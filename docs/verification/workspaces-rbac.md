# Workspace / Tenancy / RBAC verification

Milestone verified September 19, 2026 (Asia/Tehran), on `feature/workspaces-rbac`, based on the unchanged authentication milestone `e9f8153`. No main merge, history rewrite, production data, real email or later product implementation was used. Both backup stashes remain retained.

## Implemented acceptance criteria

- Authenticated workspace creation atomically persists the workspace and its single Owner membership. Database constraints reject orphan workspaces, duplicate memberships, multiple owners, or removal/demotion of the required Owner.
- Workspace list is membership-scoped. UI selection/switching survives reload as a URL preference validated against server membership, with onboarding, stale-membership handling, distinct temporary errors, bounded requests and stale-response cancellation.
- Central `WorkspaceAccess` authorization reloads membership under a workspace row lock and runs all scoped repository operations in the same transaction. Other workspace IDs cannot bypass permissions; non-member and nonexistent scopes both return 404.
- Owner/Admin/Manager/Member/Viewer match the explicitly approved [role contract](../architecture/workspace-tenancy.md). Admin cannot manage Admin/Owner; Owner cannot leave/be removed/be demoted; only Owner deletes. All non-owner roles can leave. No self role changes or ownership transfer exist.
- Invitations use a 256-bit credential with SHA-256 persistence, seven-day expiry, normalized recipient email, one-minute reissue cooldown and invalidation of the previous credential. Accept/revoke/role changes serialize; membership creation and consumption commit or roll back together. Replays, expiry, revocation and wrong recipients fail. Inviter authority is revalidated.
- Existing mail delivery abstraction is reused without a new dependency. Development mail remains private and ignored; production delivery fails honestly. Failed delivery revokes the affected invitation credential.
- UI supports create/rename/switch, member roles/removal, issue/reissue/revoke/accept invitations, leaving and confirmed deletion. It hides unsupported actions using server-returned permissions, but the server independently enforces every operation. Modal focus, labeled controls and narrow navigation remain usable.
- Existing authentication tests remain passing. The new sidebar initially exposed a mobile selector regression; that layout rule was corrected and the original browser test passed unchanged.

## Persistence

New additive migration: `20260918000000_workspace_tenancy`.

Schema additions: `WorkspaceRole`, `Workspace`, `WorkspaceMembership`, `WorkspaceInvitation`; User relations only. Old migrations remain unchanged. Workspace UUID is stable identity; duplicate names are allowed. Membership's composite primary key prevents duplication; a partial unique Owner index and deferred constraint triggers enforce a matching single Owner. Owner user deletion is restricted; workspace deletion cascades its memberships and invitations. Invitation role cannot be Owner.

All five migrations successfully deployed to a new native PostgreSQL 17 database `platform_workspace_migration_test_20260919` on the isolated loopback test cluster. No existing database was reset. All integration tests passed against this fresh database as well as the existing disposable test database.

## Actual verification

| Check                                  | Result                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------- |
| Web unit/component                     | 68 passed across eight files; 13 new workspace tests                       |
| API unit/HTTP                          | 51 passed across seven files; six new role-policy tests                    |
| PostgreSQL integration                 | 41 passed across four files; 20 new workspace tests                        |
| Real browser E2E                       | Three passed: two existing authentication flows plus one workspace journey |
| Web/API lint, strict typecheck, builds | Passed                                                                     |
| Root formatting / diff whitespace      | Passed before capability commits                                           |
| Clean migrations                       | All five passed locally and in hosted CI                                   |

Workspace PostgreSQL coverage includes atomic creation/rollback, unique membership, database owner invariants, separate/dual-tenant access, role permissions, removal then denial, normalized invitation email, simultaneous acceptance, replay, expiry, revocation, wrong recipient, reissue/cooldown, inviter demotion, acceptance/revocation races, consumption rollback and deletion cascades. HTTP checks cover missing authentication, mismatched Origin, malformed inputs, safe 404 equality and no-store failures. An additional assertion verifies mixed-case workspace routes receive the same origin protection as canonical routes.

The browser journey uses real frontend/API/PostgreSQL/cookies and development mail. It creates/switches/reloads workspaces, invites another user, accepts as that user, proves cross-tenant read/write denial, promotes to Admin, checks restricted invitation roles, removes membership, proves revoked access and checks narrow layout. No intercepted fetch responses count as E2E evidence. Local browser: installed Edge. Hosted browser: Chromium.

## CI evidence

[Quality run 35393822374](https://github.com/void-fatima/ai-saas-project-management-platform/actions/runs/35393822374) passed both `quality` and `postgres-authentication` at `65b12b9`. The latter retains its historical job name but executes the entire integration and browser suites, including workspace tests. It deployed clean PostgreSQL migrations, installed Chromium, and ran the real workspace journey successfully. The original quality gates remain intact; the branch trigger now includes `feature/workspaces-rbac`.

## Deferred work and limits

Final root Turbo lint, typecheck, unit tests and builds passed, as did Compose configuration validation. [Follow-up CI run 35394312486](https://github.com/void-fatima/ai-saas-project-management-platform/actions/runs/35394312486) passed on `c9621f8`, including the workspace route-casing fix. No tests were weakened or removed to pass the milestone.

No current milestone environment blocker remains. Docker was not required locally; native PostgreSQL was used. Production mail delivery and deployment hardening remain prerequisites for deployment. Ownership transfer, explicit invitation decline, custom roles, audit/event infrastructure, list pagination/performance work and Manager/Member/Viewer resource-specific distinctions remain future work. Projects/Tasks/Kanban, notifications, realtime, analytics, search and AI were not started. The roadmap preserves this scope.

## Changed files and commits

The change inventory is grouped by capability:

- Persistence: `apps/api/prisma/schema.prisma` and the new workspace migration.
- Server boundary: `apps/api/src/workspaces/` (controller, module, schemas, policy, access service, workspace service, invitation service and repository).
- Existing integration points: API `app.module.ts`, auth mail transport type, auth module exports, shared email schema export, and HTTP policy coverage for workspace routes. Authentication/session behavior remains intact.
- Tests: `apps/api/test/workspace-policy.spec.ts`, `apps/api/test/workspaces.integration.spec.ts`, workspace web component/hook tests and `apps/web/e2e/workspaces.spec.ts`.
- Interface: `apps/web/src/workspaces/`, `App.tsx`, `Sidebar.tsx` and the mobile navigation rule in `styles.css`.
- CI/docs: `.github/workflows/quality.yml`, README, architecture overview, workspace contract, roadmap and this record.

Capability commits: `988c358` (tenant membership/invitations), `35b11b9` (workspace interface and browser coverage), `65b12b9` (capability-branch CI), `c9621f8` (alternate route casing protection). All were pushed normally; the completed authentication branch remains at `e9f8153`.

Workspace/Tenancy/RBAC is ready for a separately authorized Projects/Tasks slice. This is not a production deployment claim.
