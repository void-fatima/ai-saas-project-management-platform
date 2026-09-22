# AI Assistant verification

Branch: `feature/ai-assistant`, based on verified dashboard/search commit `399d9fc2be90d46404ee26b7152b98b77cebc3fe`. No main merge, rewritten history, new dependency or backup-stash changes.

Scope: live provider adapter behind DI; project summaries, task action plans, editable subtask preview and explicit atomic apply; workspace authorization, bounded context/output, request budgets and metadata-only receipts. Contract/configuration: [AI assistance](../architecture/ai-assistant.md).

Focused coverage: provider schemas/errors/deadlines, unauthorized/Viewer/cross-tenant requests, request budgets, membership removal/demotion during generation, stale/expired previews, idempotent apply, ordering/versioning, second-write rollback, UI confirmation/cancel/loading/errors/late responses, and deterministic persisted browser creation within the existing workspace journey.

Local verification completed on 2026-09-22 with the repository-pinned pnpm, native PostgreSQL 17 on port 55432, and Microsoft Edge for Playwright:

| Check                                          | Result                                     |
| ---------------------------------------------- | ------------------------------------------ |
| Formatting, API/web lint and strict typechecks | Passed                                     |
| API unit/HTTP tests                            | 61 passed, 8 files                         |
| Web tests                                      | 107 passed, 13 files                       |
| PostgreSQL integration                         | 99 passed, 8 files                         |
| Browser journeys                               | All 3 covered successfully; see note below |
| API and production web builds                  | Passed                                     |
| Docker Compose configuration                   | Passed                                     |
| Fresh database migrations                      | All 9 applied; no Prisma schema drift      |

The full browser pass completed both authentication journeys and the new AI flow, then reached the existing HTTP rate limit during a later workspace refresh. The AI flow was moved into an already-open task dialog to remove redundant navigation; the affected workspace/collaboration/discovery/AI journey then passed in 36.3 seconds. Production rate limits and all assertions are unchanged. Test-helper lint findings were fixed before the remaining checks; only affected checks were repeated.

All AI tests use an injected deterministic provider or mocked HTTP transport; no live model or credentials are used. CI runs once on the pushed final commit, including all three browser journeys with Chromium. Its exact result/link is reported with delivery rather than triggering another documentation-only CI run.
