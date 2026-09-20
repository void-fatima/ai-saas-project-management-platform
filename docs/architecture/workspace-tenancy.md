# Workspace tenancy and minimal RBAC

This contract implements the approved Workspace/Tenancy/RBAC milestone. It extends authentication; a valid session alone never grants workspace access.

| Role                    | Workspace permissions                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Owner                   | View, rename/delete, invite any non-owner role, revoke invitations, remove or change any non-owner membership.                       |
| Admin                   | View, rename, invite Manager/Member/Viewer, revoke invitations for those roles, remove or change memberships only among those roles. |
| Manager, Member, Viewer | View workspace and members; leave. Differences belong to future Projects/Tasks permissions.                                          |

The creator is the single Owner. Owner invitations, removal, demotion and leaving are forbidden. Ownership transfer is deferred. Admins cannot grant/manage Admin or Owner. No self role changes are supported. All non-owner roles can leave. Only Owner can delete. These guarantees must remain when future resource permissions extend the policy.

Workspace UUID is the stable identifier; names need not be globally unique and there is no public slug namespace. Creation and owner membership are atomic. PostgreSQL enforces unique membership, a single owner and a deferred owner-membership invariant. Workspace deletion cascades its memberships/invitations and workspace-owned projects/tasks; deleting its owner account is restricted.

Every scoped operation enters a transaction that locks the workspace row, reloads membership, evaluates an explicit capability, and uses a repository bound to that workspace ID. Membership/role changes, invitation acceptance and deletion share that lock. This closes authorization-versus-removal races; a request serialized before revocation may finish, while requests serialized afterward fail. Non-members and nonexistent workspace IDs both receive 404. Members lacking a capability receive 403. Reads are serialized too for a simple coherent boundary; future performance changes must preserve its invariants.

Invitations contain 256-bit random credentials, stored only as SHA-256 hashes, expire after seven days and require an authenticated account with the same normalized email. Possession of the mail link proves access to that invited address; existing authentication verification state is not modified. Acceptance creates membership and consumes the invitation atomically. Replays, expired/revoked links and mismatched recipients fail with a generic 400. Existing membership is a 409 conflict. Reissuing the same workspace/email replaces the credential after a 60-second cooldown; old links fail. Admins cannot reissue/revoke Admin invitations. Acceptance rechecks that the inviter is still authorized to grant that role. No raw invitation credential is returned by the API or logged.

Delivery reuses the account mail boundary. Development/test links are written only to the private ignored mailbox; production returns 503 until delivery is configured. Failed delivery revokes only the just-issued credential. Sending happens outside the database transaction; a concurrent revoke/delete can render a delivered link unusable, safely.

The browser remembers only a workspace UUID preference in the URL query. It validates that preference against the signed-in account's server-loaded membership list on every load, never treating that preference or cached role as authorization. Switching cancels obsolete reads; lost membership removes scoped content, while service failures show retry. No authorization state is saved in localStorage. Invitation fragments are consumed into memory and removed from the address bar. Reloading before acceptance requires reopening the original link.

Projects, Tasks and Kanban extend this boundary through the [resource contract](projects-tasks.md), preserving every workspace-level guarantee above. Workspace deletion additionally cascades projects and their tasks/subtasks; membership removal/leave clears their assignments transactionally. Custom roles, ownership transfer, audit/event infrastructure, notifications, realtime and AI remain deferred. Future tenant-owned resources must reference Workspace and use this authorization boundary with explicitly scoped repository access.
