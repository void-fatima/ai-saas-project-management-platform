# Repository Guidance for Coding Agents

## Architecture

- Keep TypeScript strict across the monorepo.
- Maintain a React frontend and NestJS modular-monolith backend.
- PostgreSQL is the source of truth.
- Workspace is the future tenant boundary. Every future tenant-owned resource and query must be workspace-scoped.
- Redis may support queues, rate limits, sockets, or proven caches; it must never be the source of truth.
- Keep future AI integration behind a provider abstraction with validated structured outputs.
- Do not introduce microservices, Kubernetes, or distributed complexity without demonstrated need and an approved ADR.

## Engineering

- Add no dependency without a current, concrete purpose.
- Do not create fake production functionality, placeholder production logic, or empty future modules.
- Never hardcode secrets or commit `.env` files.
- Avoid `any`, unsafe casts, silent error swallowing, and hidden side effects.
- Keep controllers thin; place business rules in the appropriate service or domain boundary.
- Keep files focused, names consistent, and behavior explicit.
- Do not duplicate business rules or create abstractions before a real boundary exists.
- Do not create future packages merely to reserve names.
- Treat accessible behavior, tests, and failure states as part of the implementation.

## Scope Preservation

> Do not remove, forget, or silently discard an approved future capability merely because it is not part of the current implementation phase. Preserve valuable deferred work in the project roadmap.

`docs/roadmap/product-roadmap.md` is the source of truth for deferred product and hardening work. Update it when an approved decision changes scope or sequencing.

## Security

- Authentication is not authorization.
- Frontend state is never a security boundary; authorization must be enforced server-side.
- Secrets never enter Git, logs, browser bundles, or error responses.
- Future tenant-owned resources must be loaded through workspace-scoped access paths.
- Future cache keys, socket rooms, jobs, search, analytics, exports, and AI context must preserve tenant boundaries.
- Use parameterized database access, validate inputs at boundaries, and redact sensitive logs.

## Workflow

Before implementing a future phase:

1. Inspect the repository and working-tree state.
2. Read this `AGENTS.md` completely.
3. Read the roadmap and relevant architecture decisions.
4. Identify the explicitly authorized current phase.
5. Avoid implementing unrelated later-phase features.
6. Preserve valuable deferred requirements in documentation.
7. Implement the smallest complete vertical slice.
8. Run every relevant format, lint, typecheck, test, and build check.
9. Report only verification that was actually performed.
