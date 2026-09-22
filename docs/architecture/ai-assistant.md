# AI assistance contract

The current slice provides project summaries, task action plans, and editable root-task subtask proposals. All generated text is advisory, rendered as plain text, and requires explicit confirmation before creating subtasks. Existing workspace governance is unchanged; ownership transfer remains deferred.

## Authorization and context

`WorkspaceAccess` resolves current membership under the existing workspace lock. Owner/Admin/Manager/Member use the existing resource `edit` permission. Viewer cannot generate or apply: generation incurs provider cost and persists reservation metadata, so it is not a read-only operation. Removed members cannot receive pending results or apply receipts. Every project, root, child and parent reference is loaded through workspace/project-scoped queries. Archived projects reject generation/apply.

Context is assembled only from persisted selected project/task state. Summary includes project descriptions, status counts, and at most 40 recent root/subtask records. Task actions include the selected task, project description, optional parent, and at most 40 children. Descriptions are clipped to 1,000 project / 2,000 selected task / 500 parent / 200 other-task characters. UTF-8 context is capped at 24,000 bytes, with a visible truncation flag. No member emails, sessions, comments, other projects or client-supplied context are sent. Tenant text remains untrusted data separate from provider instructions; the provider has no tools or execution authority.

## API and structured output

All POST bodies and route IDs are strict schema-validated. Generation bodies contain only `{requestId: UUID}`. Prefix: `/workspaces/:workspaceId/projects/:projectId`.

| Route                               | Output                                        |
| ----------------------------------- | --------------------------------------------- |
| `/ai/summary`                       | summary, up to 6 highlights and 4 limitations |
| `/tasks/:taskId/ai/plan`            | summary, 1–8 steps and up to 4 questions      |
| `/tasks/:taskId/ai/breakdown`       | summary, 1–8 title/description drafts         |
| `/tasks/:taskId/ai/breakdown/apply` | `{createdCount}` after explicit approval      |

Nested `/tasks/:parentId/subtasks/:taskId/ai/plan` also validates the parent chain. Breakdown/apply reject grandchildren. Summary length is 1,200 characters; lines 500; subtask titles 200 and descriptions 2,000. Unknown fields, empty/duplicate titles, malformed/refused/incomplete output and output over 24,000 UTF-8 bytes fail safely. Every provider result is validated again by the application. The response includes request, operation, provider/model, available normalized token usage and context truncation metadata.

Apply accepts `{requestId, subtasks:[{title,description}]}`. A successful generation receipt binds workspace, user, project, root task and root version, and expires for new application after 15 minutes. Apply reauthorizes, rejects a changed root/version and case-insensitive existing sibling titles, then reuses `ProjectService` task creation within one transaction. Approved drafts become unassigned TODO subtasks at the normal end positions with initial version 1 and transactional activity. Any failure rolls back every creation and the receipt update. Identical applied payloads replay the stored count without new writes; changed payloads return 409. Replays also require current authorization and an active project/task. No raw preview persistence or implicit AI mutation occurs.

## Provider configuration and limits

Default `AI_PROVIDER=disabled` returns an honest 503. To enable the live adapter, set server-only `AI_PROVIDER=openai`, `AI_MODEL` to a structured-output-capable model ID, and `AI_API_KEY` in the deployment secret environment. Never prefix keys with `VITE_`. No SDK/dependency was added. The adapter uses the fixed HTTPS [OpenAI Responses API](https://developers.openai.com/api/docs/guides/structured-outputs), strict JSON Schema and `store:false`; this flag does not claim zero provider-side retention. Confirm the provider's data terms before enabling sensitive workspace content.

`AI_TIMEOUT_MS` defaults to 15,000 (100–30,000); `AI_MAX_OUTPUT_TOKENS` defaults to 2,048 (256–4,096). Total upstream JSON is capped at 65,536 bytes. All operations have a hard deadline and abort signal; there are no automatic retries. Provider errors are normalized without upstream bodies or secrets.

PostgreSQL reservations serialize under the workspace lock: at most 6 requests per user per workspace per rolling minute, 60 per workspace per rolling hour, and 4 pending requests from the last minute per workspace. Failed attempts count conservatively. A duplicate request ID returns 409 before another provider call. Abandoned pending reservations leave the concurrency window after a minute but remain in the hourly budget. These are attempt/token ceilings, not monetary billing guarantees. Network work occurs outside the database transaction; membership, permissions and bounded context are checked again before returning results.

`AiProvider` is injected. Tests override it with deterministic fixtures; browser tests select `AI_PROVIDER=test`, permitted only with `NODE_ENV=test`. Automated verification makes no external AI calls. Live credentials/model behavior require a deployment smoke check and are not claimed verified by fixture tests.

## Persistence and deferred work

Additive migration `20260922000000_ai_assistance` stores `ai_runs`: tenant/user/resource IDs, operation/status, provider/model, optional tokens/duration, root version, and applied count/payload hash. Workspace/user deletion cascades metadata; resource IDs are historical references, never authorization. No full prompt, response, key or error body is persisted or logged. Apply emits the same activity/SSE refresh hint as ordinary task creation; previews do not emit domain activity.

Operators may delete metadata older than 30 days in bounded batches; task data remains independent. Automatic retention, provider/model evaluation, monetary budgets, richer usage administration, background generation, full project planning, AI health/reports and RAG/vector search remain roadmap work. Losing an old receipt ends replay support, so retain at least the 15-minute apply and one-hour budget windows. Generated output may be incomplete or wrong; schema validation is not a factual guarantee.
