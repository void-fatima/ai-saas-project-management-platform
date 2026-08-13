# Product Roadmap

This document preserves approved product scope while keeping implementation incremental. A deferred capability remains part of the product unless an explicit, documented architecture or product decision replaces it.

## Scope Classification

- **Current Phase:** Phase 1 foundation only.
- **Core Future Phase:** Phases 2–21, delivering the secure collaborative product and its primary AI value.
- **Production Hardening:** Phases 22–27, continuously considered earlier and formally hardened here.
- **Advanced Future Phase:** deeper real-time, analytics, search, AI, enterprise, and infrastructure capabilities after core workflows prove their value.
- **Nice-to-Have / Bonus:** Phase 29 and the Future / Bonus Backlog. These are preserved but unscheduled.

Security, tenant isolation, accessibility, testing, and observability are continuous concerns; their named hardening phases are not permission to postpone basic safeguards.

## Phased Delivery

### 1. Foundation — Current Phase

- **Objective:** establish a reproducible full-stack TypeScript monorepo.
- **Major deliverables:** React/Vite web shell; NestJS API and `/health`; validated environment; PostgreSQL Compose service; strict TypeScript; lint, format, tests, build, documentation, and CI.
- **Dependencies:** none.
- **Main risks:** unused abstractions, cross-platform scripts, configuration drift, or overstating implemented functionality.
- **Definition of Done:** clean install; format, lint, typecheck, tests, and builds pass; Compose is valid; current versus planned scope is accurate.

### 2. Authentication — Core Future Phase

- **Objective:** provide secure user identity and session lifecycle.
- **Major deliverables:** registration, login/logout, email verification, forgot/reset password, Argon2id hashing, opaque secure-cookie sessions, rotation, revocation, logout-all-devices, protected routes, and authentication rate limits.
- **Dependencies:** Phase 1 and the first reviewed persistence schema.
- **Main risks:** account enumeration, token leakage, weak cookies, broken revocation, and confusing authentication with authorization.
- **Definition of Done:** security-sensitive integration tests cover valid, invalid, expired, rotated, and revoked flows; secrets and sensitive logs are redacted.

### 3. Workspace System — Core Future Phase

- **Objective:** introduce organizations and membership lifecycle.
- **Major deliverables:** create/edit/delete/switch workspace, membership, expiring hashed invitations, accept/decline, leave, member removal, and settings foundation.
- **Dependencies:** Phase 2.
- **Main risks:** orphaned ownership, invitation abuse, and ambiguous membership states.
- **Definition of Done:** lifecycle constraints are enforced, the last owner is protected, and tests cover multiple workspaces per user.

### 4. Multi-Tenancy — Core Future Phase

- **Objective:** make Workspace the non-bypassable tenant boundary.
- **Major deliverables:** `workspaceId` on tenant-owned rows, tenant-aware constraints/indexes, scoped repositories, verified request context, IDOR protection, and isolation suites for API/list/search paths.
- **Dependencies:** Phase 3.
- **Main risks:** cross-tenant reads/writes, global unique constraints, and indirect-resource leakage.
- **Definition of Done:** users from one workspace cannot read, mutate, enumerate, cache-hit, or infer resources from another; CI runs isolation tests. PostgreSQL RLS is evaluated as later defense-in-depth.

### 5. RBAC — Core Future Phase

- **Objective:** enforce capability-based server authorization within each tenant.
- **Major deliverables:** Owner, Admin, Manager, Member, Viewer; capability matrix; guards/policies; resource-level checks; ownership rules; audited role changes; useful project restrictions.
- **Dependencies:** Phases 3–4.
- **Main risks:** scattered role comparisons, privilege escalation, and project permissions exceeding workspace membership.
- **Definition of Done:** policy tests cover allow/deny paths, owner invariants, and server enforcement independent of frontend state.

### 6. Projects — Core Future Phase

- **Objective:** deliver workspace-scoped project management.
- **Major deliverables:** create/read/update/archive projects, status, dates, overview, members, and milestones when validated by product needs.
- **Dependencies:** Phase 5.
- **Main risks:** inconsistent membership and unbounded listings.
- **Definition of Done:** CRUD, archive, pagination, authorization, tenant isolation, validation, activity, and audit-sensitive actions are tested.

### 7. Tasks — Core Future Phase

- **Objective:** model actionable work with reliable constraints.
- **Major deliverables:** task CRUD, status, priority, creator/reporter, one or multiple assignees when justified, labels, due dates, ordering, subtasks, attachments metadata, and history.
- **Dependencies:** Phase 6.
- **Main risks:** schema churn, invalid cross-workspace references, ordering races, and attachment security.
- **Definition of Done:** task invariants and scoped relationships are database-enforced; list endpoints paginate/filter; critical policies have integration tests.

### 8. Kanban — Core Future Phase

- **Objective:** provide a fast, accessible visual workflow.
- **Major deliverables:** responsive columns, dnd-kit drag-and-drop, persisted ordering, optimistic updates, rollback, keyboard operation, focus states, and concurrency handling.
- **Dependencies:** Phase 7.
- **Main risks:** reorder races, inaccessible dragging, and client/server divergence.
- **Definition of Done:** pointer and keyboard journeys work, failed mutations visibly roll back, and ordering remains stable under concurrent requests.

### 9. Task Details — Core Future Phase

- **Objective:** expose a focused deep-edit workflow.
- **Major deliverables:** linkable drawer/page, descriptions, status, assignees, labels, due dates, subtasks, attachments, history, validation, loading/error/retry states, and destructive confirmations.
- **Dependencies:** Phases 7–8.
- **Main risks:** giant components, lost edits, unsafe rich content, and mobile usability.
- **Definition of Done:** fields are permission-aware, accessible, responsive, resilient to failures, and covered by component/E2E tests.

### 10. Collaboration — Core Future Phase

- **Objective:** make project work discussable and traceable.
- **Major deliverables:** comments, mentions, safe user references, activity feed, collaboration history, and sanitized rich text only if introduced.
- **Dependencies:** Phase 9.
- **Main risks:** XSS, mention abuse, event duplication, and conflating Activity with AuditLog.
- **Definition of Done:** content is safely rendered, mentions resolve only inside the tenant, and activity is transactionally consistent with supported actions.

### 11. Notifications — Core Future Phase

- **Objective:** provide actionable, non-duplicated updates.
- **Major deliverables:** inbox, read/unread, assignments, mentions, comments, deadlines, preferences, idempotency, and later email delivery where valuable.
- **Dependencies:** Phase 10.
- **Main risks:** noise, duplicates, unauthorized resource references, and failed fan-out.
- **Definition of Done:** event mappings are explicit, tenant-safe, idempotent, preference-aware, and tested.

### 12. Real-Time — Core/Advanced Future Phase

- **Objective:** synchronize useful collaborative changes without making sockets a second business layer.
- **Major deliverables:** live task/comment/notification updates, authorized rooms, reconnect/resync, duplicate-event handling, optional presence, and Redis adapter only for horizontal scale.
- **Dependencies:** stable Phases 8–11.
- **Main risks:** socket authorization bypass, missed/duplicate events, ordering problems, and premature complexity.
- **Definition of Done:** REST remains authoritative; socket joins revalidate membership; reconnect and duplicate scenarios pass integration tests.

### 13. Dashboard — Core Future Phase

- **Objective:** summarize meaningful work and attention areas.
- **Major deliverables:** active projects, open/overdue tasks, completion/progress, personal/team workload, and activity summary with clear definitions.
- **Dependencies:** Phases 6–11.
- **Main risks:** misleading metrics and slow aggregate queries.
- **Definition of Done:** metric definitions are documented, tenant-scoped, indexed, tested against fixtures, and presented with loading/empty/error states.

### 14. AI Project Generator — Core Future Phase

- **Objective:** turn a brief into a reviewable project-plan draft.
- **Major deliverables:** provider abstraction, structured schema-validated output for title, goal, milestones, tasks, priorities, suggested assignees/dates, and risks; edit/approve before atomic persistence.
- **Dependencies:** Projects, Tasks, tenant context, and job decision.
- **Main risks:** hallucination, invalid assignments, vendor coupling, latency, secrets, and unbounded cost.
- **Definition of Done:** output is labeled draft, grounded in allowed tenant context, validated, editable, cost/usage-aware, timeout-bounded, and never persisted without confirmation.

### 15. AI Task Breakdown — Core Future Phase

- **Objective:** propose editable subtasks for large work items.
- **Major deliverables:** selected-task context, structured subtask drafts, duplication checks, edit/approve, and atomic creation.
- **Dependencies:** Phase 14 abstraction and Phase 7 subtasks.
- **Main risks:** generic output, duplicates, context leakage, and destructive automatic changes.
- **Definition of Done:** suggestions are useful, tenant-contained, schema-valid, and user-approved before persistence.

### 16. AI Project Health — Advanced Future Phase

- **Objective:** identify evidence-based project risks and recommendations.
- **Major deliverables:** analysis of overdue work, blockers, stalled areas, workload, imbalance, and risk with source references and limitations.
- **Dependencies:** dashboard metrics, activity history, and AI abstraction.
- **Main risks:** misleading conclusions, sensitive-data exposure, and treating recommendations as truth.
- **Definition of Done:** recommendations map to real authorized data, expose assumptions, are reproducible enough for tests, and remain advisory.

### 17. AI Reports — Advanced Future Phase

- **Objective:** generate daily/weekly summaries without blocking requests.
- **Major deliverables:** completed/new/overdue work, progress, blockers, and risks; scheduled/retryable jobs, report history, prompt versions, bounded retries, usage/cost logging, and approval/delivery controls.
- **Dependencies:** Phases 11, 14, 16 and background jobs.
- **Main risks:** duplicate reports, stale data, job failure, runaway costs, and disclosure in delivery channels.
- **Definition of Done:** jobs are idempotent and correlated, failures observable, content tenant-safe, and delivery preference-aware.

### 18. Analytics — Advanced Future Phase

- **Objective:** provide trustworthy operational insight.
- **Major deliverables:** completion rate, throughput, cycle time, overdue trends, workload distribution, health, velocity, and completion-over-time where meaningful.
- **Dependencies:** mature task/activity data.
- **Main risks:** vanity metrics, gaming, expensive queries, and unfair productivity claims.
- **Definition of Done:** every metric has a definition, caveats, fixture tests, tenant scope, indexes, and performance target.

### 19. Search & Filters — Core/Advanced Future Phase

- **Objective:** find projects, tasks, and appropriate users quickly.
- **Major deliverables:** tenant-scoped search; assignee, priority, status, and deadline filters; sorting, pagination, combined filters, debouncing, and later saved views.
- **Dependencies:** Projects and Tasks.
- **Main risks:** tenant leakage, slow wildcard queries, inconsistent pagination, and stale results.
- **Definition of Done:** authorization applies before results, query plans meet budgets, combined filters are tested, and no cross-tenant inference is possible.

### 20. Audit Logs — Core Future Phase

- **Objective:** create a restricted append-oriented security trail distinct from activity.
- **Major deliverables:** actor, workspace, action, target, timestamp, safe metadata; role/invitation/security/admin events; filtering; restricted access; optional later export.
- **Dependencies:** RBAC and sensitive workflows.
- **Main risks:** sensitive metadata, missing critical events, mutable records, and excessive volume.
- **Definition of Done:** event coverage and retention are documented, access is policy-tested, metadata redacted, and application paths cannot silently alter history.

### 21. Settings — Core Future Phase

- **Objective:** consolidate safe personal and workspace administration.
- **Major deliverables:** profile, workspace, membership, notification, security, session, and AI preference settings with confirmations and feedback.
- **Dependencies:** relevant core phases.
- **Main risks:** privilege escalation, accidental destructive actions, and confusing ownership transfer.
- **Definition of Done:** all mutations are server-authorized, validated, audited where sensitive, accessible, and covered by E2E tests.

### 22. Security Hardening — Production Hardening

- **Objective:** close security gaps before production while maintaining a baseline from Phase 1.
- **Major deliverables:** threat model; secret management; normalization; SQL injection/XSS/CSRF/CORS/CSP/headers controls; rate/body/file limits; safe errors; redacted logs; dependency scanning; HTTPS; least privilege; secure attachments and health; RLS evaluation.
- **Dependencies:** stable feature surface.
- **Main risks:** late architectural findings and checklist-only security.
- **Definition of Done:** reviewed threat model, tenant/IDOR suite, zero unresolved critical/high findings, dependency policy, and documented residual risks. MFA, passkeys, SSO/OIDC, WAF, secret rotation, malware scanning, retention, SBOM, and external penetration testing remain evaluated production/enterprise options.

### 23. Testing Hardening — Production Hardening

- **Objective:** make critical behavior and migrations release-gating.
- **Major deliverables:** unit, component, API, integration, tenant-isolation, security, migration, and E2E suites; fixtures; critical journeys; flaky-test cleanup.
- **Dependencies:** stable feature surface and CI.
- **Main risks:** brittle tests, excessive mocks, slow CI, and misleading coverage.
- **Definition of Done:** authentication, membership, role changes, tenant access, project/task policies, AI persistence, and Kanban ordering have strong integration coverage with tracked flake rate.

### 24. Performance — Production Hardening

- **Objective:** meet measured responsiveness and scalability budgets.
- **Major deliverables:** pagination, index/query review, profiling, bundle optimization, lazy loading, search debouncing, justified cache, performance budgets, and before/after benchmarks.
- **Dependencies:** realistic workloads and observability.
- **Main risks:** premature caching, stale tenant data, and optimizing synthetic cases.
- **Definition of Done:** budgets and representative datasets are documented, regressions measured, cache keys tenant-safe, and improvements have evidence.

### 25. Infrastructure — Production Hardening

- **Objective:** package and operate the actual application safely.
- **Major deliverables:** Docker images, Compose for required services, frontend/API, worker and Redis only when needed, Nginx or managed edge, production env config, non-root containers, health/readiness, persistent database strategy.
- **Dependencies:** stable builds and runtime requirements.
- **Main risks:** oversized/privileged images, migration races, configuration drift, and unnecessary services.
- **Definition of Done:** reproducible images, vulnerability checks, healthchecks, graceful shutdown, environment separation, and local/staging smoke tests pass.

### 26. CI/CD — Production Hardening

- **Objective:** automate trustworthy validation and staged delivery.
- **Major deliverables:** format, lint, typecheck, unit/integration/isolation/E2E tests as they exist, build, migration validation, dependency/security scans, image build, staging/production gates, rollback, and branch protection.
- **Dependencies:** Phases 23 and 25.
- **Main risks:** secret leakage, slow/flaky pipelines, and irreversible deploys.
- **Definition of Done:** protected branches require real checks, least-privilege credentials are used, artifacts are traceable, and rollback is rehearsed.

### 27. Production Deployment — Production Hardening

- **Objective:** launch with recoverability and operational visibility.
- **Major deliverables:** domain, TLS, production PostgreSQL/Redis when needed, backups, restore procedure, monitoring, alerts, logs, error tracking, metrics/traces, smoke tests, runbooks, health/readiness, secrets, and rollback.
- **Dependencies:** Phase 26 and security sign-off.
- **Main risks:** data loss, untested restore, alert fatigue, downtime, and secret exposure.
- **Definition of Done:** backup restore drill succeeds, alerts and runbooks are actionable, deployment/rollback smoke tests pass, and ownership is clear.

### 28. Final UI/UX Polish — Production Hardening

- **Objective:** make the product accessible, coherent, responsive, and demo-ready.
- **Major deliverables:** mobile/desktop QA, keyboard navigation, focus/contrast, accessible components, skeleton/loading/empty/error/retry states, confirmations, toasts, typography/spacing/hierarchy, onboarding, polished forms, drag usability, useful motion, optional dark mode, demo data and rehearsed flow.
- **Dependencies:** complete primary journeys.
- **Main risks:** cosmetic-only polish, accessibility regressions, and unrealistic demo data.
- **Definition of Done:** core journeys pass accessibility and responsive QA, feedback states are complete, reduced-motion is respected, and the demo can run reliably end-to-end.

### 29. Advanced / Bonus Product Features — Nice-to-Have / Bonus

- **Objective:** extend proven workflows without destabilizing the core.
- **Major deliverables:** selected items from the backlog based on evidence and business value.
- **Dependencies:** production stability, usage evidence, and an explicit scoped decision.
- **Main risks:** feature sprawl, enterprise complexity, and maintaining low-value integrations.
- **Definition of Done:** each selected feature has validated demand, tenant/security design, accessibility, tests, observability, documentation, and its own rollout/rollback plan.

## Future / Bonus Backlog

Nothing in this section is implemented or scheduled merely by being listed.

### Product and Workflow

- calendar and Gantt/timeline views
- custom workflows, statuses, fields, and roles
- project/workspace templates
- saved searches and saved views
- keyboard shortcuts and command palette
- activity filtering, data export, and project import
- advanced notification preferences
- attachments backed by secure object storage
- richer milestones, dependencies, recurring tasks, and automation rules

### Platform and Ecosystem

- webhooks and third-party integrations
- API tokens and a documented external API
- feature flags and controlled experiments
- mobile applications
- localization and expanded accessibility support
- integration marketplace where justified

### Commercial and Enterprise

- billing plans and Free/Pro/Enterprise packaging
- quotas and usage visibility
- SSO/OIDC, MFA, passkeys, provisioning, and enterprise policies
- advanced audit export, retention, legal hold, and regional/data residency options if required

### Security and Operations

- PostgreSQL RLS as defense-in-depth
- WAF, automated secret rotation, malware scanning, SBOM, external penetration tests
- disaster-recovery targets, multi-region evaluation, and advanced operational dashboards
- Redis-backed distributed limits, Socket.IO scaling, and BullMQ only when traffic/jobs justify them

### Experience

- deeper onboarding and contextual help
- thoughtful dark mode and visual themes
- animation and transition refinements with reduced-motion support
- richer demo environments and guided product tours
