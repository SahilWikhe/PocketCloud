import type { SqlExecutor } from "./client";
import type { AppRecord, AppStatus } from "./models";
import { toIso } from "./models";

interface AppRow {
  id: string;
  actor_key: string;
  name: string;
  slug: string;
  status: AppStatus;
  active_version_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapApp(row: AppRow): AppRecord {
  return {
    id: row.id,
    actorKey: row.actor_key,
    name: row.name,
    slug: row.slug,
    status: row.status,
    activeVersionId: row.active_version_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class AppRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async create(input: {
    id: string;
    actorKey: string;
    name: string;
    slug: string;
  }): Promise<AppRecord> {
    const result = await this.sql.query<AppRow>(
      `INSERT INTO apps (id, actor_key, name, slug)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.id, input.actorKey, input.name, input.slug],
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

  async setStatus(id: string, status: AppStatus): Promise<AppRecord | null> {
    const result = await this.sql.query<AppRow>(
      "UPDATE apps SET status = $2, updated_at = now() WHERE id = $1 RETURNING *",
      [id, status],
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
