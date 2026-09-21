import { Prisma, type TaskStatus } from '../generated/prisma/client.js';
import type { SearchInput } from './discovery.schemas.js';

export interface SearchResult {
  kind: 'PROJECT' | 'TASK' | 'SUBTASK';
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  snippet: string;
  status: TaskStatus | null;
  archived: boolean;
  updatedAt: Date;
}

// Literal substring matching: SQL wildcard characters in user input have no special meaning.
function literal(value: string) {
  return value.replace(/[\\%_]/gu, '\\$&');
}

// A single parameterized UNION permits global ranking and pagination across resource kinds.
// Both arms apply the tenant predicate before matching. No unscoped IDs leave PostgreSQL.
export function searchQuery(workspaceId: string, input: SearchInput) {
  const contains = `%${literal(input.q)}%`;
  const prefix = `${literal(input.q)}%`;
  return Prisma.sql`
    WITH candidates AS (
      SELECT 'PROJECT'::text AS kind, p.id, p.id AS "projectId", NULL::uuid AS "parentId",
        p.name AS title, p.description, NULL::text AS status, p.archived, p.updated_at AS "updatedAt"
      FROM projects p WHERE p.workspace_id = ${workspaceId}::uuid AND (${input.includeArchived} OR NOT p.archived)
      UNION ALL
      SELECT CASE WHEN t.parent_id IS NULL THEN 'TASK' ELSE 'SUBTASK' END,
        t.id, t.project_id, t.parent_id, t.title, t.description, t.status::text, p.archived, t.updated_at
      FROM tasks t JOIN projects p ON p.workspace_id = t.workspace_id AND p.id = t.project_id
      WHERE t.workspace_id = ${workspaceId}::uuid AND p.workspace_id = ${workspaceId}::uuid
        AND (${input.includeArchived} OR NOT p.archived)
    ), normalized AS (
      SELECT *, regexp_replace(btrim(title), '[[:space:]]+', ' ', 'g') AS normalized_title,
        regexp_replace(btrim(description), '[[:space:]]+', ' ', 'g') AS normalized_description
      FROM candidates
    )
    SELECT kind, id, "projectId", "parentId", title, left(description, 160) AS snippet,
      status, archived, "updatedAt"
    FROM normalized
    WHERE normalized_title ILIKE ${contains} OR normalized_description ILIKE ${contains}
    ORDER BY CASE WHEN lower(normalized_title) = lower(${input.q}) THEN 0
      WHEN normalized_title ILIKE ${prefix} THEN 1
      WHEN normalized_title ILIKE ${contains} THEN 2 ELSE 3 END,
      "updatedAt" DESC, id ASC, kind ASC
    LIMIT ${input.limit + 1} OFFSET ${input.offset}`;
}

export class SearchScope {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly workspaceId: string,
  ) {}
  async read(input: SearchInput) {
    if (!input.q) return { items: [], nextOffset: null };
    const rows = await this.tx.$queryRaw<SearchResult[]>(searchQuery(this.workspaceId, input));
    return {
      items: rows.slice(0, input.limit),
      nextOffset:
        rows.length > input.limit && input.offset + input.limit <= 10000
          ? input.offset + input.limit
          : null,
    };
  }
}
