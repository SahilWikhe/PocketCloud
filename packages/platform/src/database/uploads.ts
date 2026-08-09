import type { SqlExecutor } from "./client";
import type { UploadIntentRecord, UploadIntentStatus } from "./models";
import { toIso, toOptionalIso } from "./models";

interface UploadIntentRow {
  id: string;
  actor_key: string;
  version_id: string;
  planned_artifact_id: string;
  storage_key: string;
  expected_sha256: string;
  expected_bytes: string | number;
  content_type: "application/zip";
  status: UploadIntentStatus;
  expires_at: string | Date;
  completed_at: string | Date | null;
  created_at: string | Date;
}

function mapUploadIntent(row: UploadIntentRow): UploadIntentRecord {
  return {
    id: row.id,
    actorKey: row.actor_key,
    versionId: row.version_id,
    plannedArtifactId: row.planned_artifact_id,
    storageKey: row.storage_key,
    expectedSha256: row.expected_sha256,
    expectedBytes: Number(row.expected_bytes),
    contentType: row.content_type,
    status: row.status,
    expiresAt: toIso(row.expires_at),
    completedAt: toOptionalIso(row.completed_at),
    createdAt: toIso(row.created_at),
  };
}

export class UploadIntentRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async create(input: {
    id: string;
    actorKey: string;
    versionId: string;
    plannedArtifactId: string;
    storageKey: string;
    expectedSha256: string;
    expectedBytes: number;
    expiresAt: string;
  }): Promise<UploadIntentRecord> {
    const result = await this.sql.query<UploadIntentRow>(
      `INSERT INTO upload_intents (
         id, actor_key, version_id, planned_artifact_id, storage_key,
         expected_sha256, expected_bytes, content_type, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'application/zip', $8)
       RETURNING *`,
      [
        input.id,
        input.actorKey,
        input.versionId,
        input.plannedArtifactId,
        input.storageKey,
        input.expectedSha256,
        input.expectedBytes,
        input.expiresAt,
      ],
    );
    return mapUploadIntent(result.rows[0]!);
  }

  async findById(id: string): Promise<UploadIntentRecord | null> {
    const result = await this.sql.query<UploadIntentRow>(
      "SELECT * FROM upload_intents WHERE id = $1",
      [id],
    );
    return result.rows[0] ? mapUploadIntent(result.rows[0]) : null;
  }

  async findByIdForUpdate(id: string): Promise<UploadIntentRecord | null> {
    const result = await this.sql.query<UploadIntentRow>(
      "SELECT * FROM upload_intents WHERE id = $1 FOR UPDATE",
      [id],
    );
    return result.rows[0] ? mapUploadIntent(result.rows[0]) : null;
  }

  async markCompleted(id: string): Promise<UploadIntentRecord | null> {
    const result = await this.sql.query<UploadIntentRow>(
      `UPDATE upload_intents
       SET status = 'COMPLETED', completed_at = now()
       WHERE id = $1 AND status = 'PENDING' AND expires_at > now()
       RETURNING *`,
      [id],
    );
    return result.rows[0] ? mapUploadIntent(result.rows[0]) : null;
  }

  async reject(id: string): Promise<void> {
    await this.sql.query(
      "UPDATE upload_intents SET status = 'REJECTED' WHERE id = $1 AND status = 'PENDING'",
      [id],
    );
  }
}
