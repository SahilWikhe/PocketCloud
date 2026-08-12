import type { SqlExecutor } from "./client";
import type { AppRecord, AppStatus, AppSuspensionSource } from "./models";
import { toIso, toOptionalIso } from "./models";

interface AppRow {
  id: string;
  actor_key: string;
  workspace_id: string | null;
  name: string;
  slug: string;
  status: AppStatus;
  suspension_source: AppSuspensionSource | null;
  active_version_id: string | null;
  deleted_at: string | Date | null;
  recoverable_until: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapApp(row: AppRow): AppRecord {
  return {
    id: row.id,
    actorKey: row.actor_key,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    suspensionSource: row.suspension_source,
    activeVersionId: row.active_version_id,
    deletedAt: toOptionalIso(row.deleted_at),
    recoverableUntil: toOptionalIso(row.recoverable_until),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class AppRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async create(input: {
    id: string;
    actorKey: string;
    workspaceId?: string;
    name: string;
    slug: string;
  }): Promise<AppRecord> {
    const result = await this.sql.query<AppRow>(
      `INSERT INTO apps (id, actor_key, workspace_id, name, slug)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.id, input.actorKey, input.workspaceId ?? null, input.name, input.slug],
    );
    return mapApp(result.rows[0]!);
  }

  async findById(id: string): Promise<AppRecord | null> {
    const result = await this.sql.query<AppRow>("SELECT * FROM apps WHERE id = $1", [id]);
    return result.rows[0] ? mapApp(result.rows[0]) : null;
  }

  async findByIdForUpdate(id: string): Promise<AppRecord | null> {
    const result = await this.sql.query<AppRow>("SELECT * FROM apps WHERE id = $1 FOR UPDATE", [id]);
    return result.rows[0] ? mapApp(result.rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<AppRecord | null> {
    const result = await this.sql.query<AppRow>("SELECT * FROM apps WHERE slug = $1", [slug]);
    return result.rows[0] ? mapApp(result.rows[0]) : null;
  }

  async listByWorkspace(workspaceId: string): Promise<readonly AppRecord[]> {
    const result = await this.sql.query<AppRow>(
      `SELECT * FROM apps
       WHERE workspace_id = $1
         AND (status <> 'DELETED' OR recoverable_until > now())
       ORDER BY updated_at DESC, id`,
      [workspaceId],
    );
    return result.rows.map(mapApp);
  }

  async setStatus(
    id: string,
    status: AppStatus,
    suspensionSource?: AppSuspensionSource,
  ): Promise<AppRecord | null> {
    const result = await this.sql.query<AppRow>(
      `UPDATE apps
       SET status = $2,
           suspension_source = CASE WHEN $2 = 'SUSPENDED' THEN $3 ELSE NULL END,
           deleted_at = NULL,
           recoverable_until = NULL,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, status, suspensionSource ?? null],
    );
    return result.rows[0] ? mapApp(result.rows[0]) : null;
  }

  async softDelete(id: string, recoverableUntil: string): Promise<AppRecord | null> {
    const result = await this.sql.query<AppRow>(
      `UPDATE apps
       SET status = 'DELETED',
           suspension_source = NULL,
           deleted_at = now(),
           recoverable_until = $2::timestamptz,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, recoverableUntil],
    );
    return result.rows[0] ? mapApp(result.rows[0]) : null;
  }

  async promoteVersion(id: string, versionId: string): Promise<AppRecord | null> {
    const result = await this.sql.query<AppRow>(
      `UPDATE apps
       SET active_version_id = $2, updated_at = now()
       WHERE id = $1 AND status = 'ACTIVE'
       RETURNING *`,
      [id, versionId],
    );
    return result.rows[0] ? mapApp(result.rows[0]) : null;
  }
}
