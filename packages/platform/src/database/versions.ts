import type { ProjectPlanV1 } from "@pocketcloud/core";

import type { SqlExecutor } from "./client";
import type { AppVersionRecord } from "./models";
import { toIso } from "./models";

interface VersionRow {
  id: string;
  app_id: string;
  sequence: number;
  original_artifact_id: string | null;
  normalized_artifact_id: string | null;
  project_plan: ProjectPlanV1 | null;
  platform_check_status: string;
  created_at: string | Date;
}

function mapVersion(row: VersionRow): AppVersionRecord {
  return {
    id: row.id,
    appId: row.app_id,
    sequence: row.sequence,
    originalArtifactId: row.original_artifact_id,
    normalizedArtifactId: row.normalized_artifact_id,
    projectPlan: row.project_plan,
    platformCheckStatus: row.platform_check_status,
    createdAt: toIso(row.created_at),
  };
}

export class VersionRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async createPending(input: { id: string; appId: string }): Promise<AppVersionRecord> {
    await this.sql.query("SELECT id FROM apps WHERE id = $1 FOR UPDATE", [input.appId]);
    const result = await this.sql.query<VersionRow>(
      `INSERT INTO app_versions (id, app_id, sequence)
       SELECT $1, $2, COALESCE(MAX(sequence), 0) + 1
       FROM app_versions
       WHERE app_id = $2
       RETURNING *`,
      [input.id, input.appId],
    );
    return mapVersion(result.rows[0]!);
  }

  async sealOriginalArtifact(input: {
    versionId: string;
    artifactId: string;
  }): Promise<AppVersionRecord | null> {
    const result = await this.sql.query<VersionRow>(
      `UPDATE app_versions
       SET original_artifact_id = $2, platform_check_status = 'QUARANTINED'
       WHERE id = $1 AND original_artifact_id IS NULL AND platform_check_status = 'UPLOADING'
       RETURNING *`,
      [input.versionId, input.artifactId],
    );
    return result.rows[0] ? mapVersion(result.rows[0]) : null;
  }

  async findById(id: string): Promise<AppVersionRecord | null> {
    const result = await this.sql.query<VersionRow>("SELECT * FROM app_versions WHERE id = $1", [id]);
    return result.rows[0] ? mapVersion(result.rows[0]) : null;
  }

  async recordWorkerOutput(input: {
    versionId: string;
    normalizedArtifactId?: string;
    projectPlan?: ProjectPlanV1;
    platformCheckStatus?: AppVersionRecord["platformCheckStatus"];
  }): Promise<AppVersionRecord | null> {
    const result = await this.sql.query<VersionRow>(
      `UPDATE app_versions
       SET normalized_artifact_id = COALESCE($2, normalized_artifact_id),
           project_plan = COALESCE($3, project_plan),
           platform_check_status = COALESCE($4, platform_check_status)
       WHERE id = $1
         AND ($2::text IS NULL OR normalized_artifact_id IS NULL OR normalized_artifact_id = $2)
       RETURNING *`,
      [
        input.versionId,
        input.normalizedArtifactId ?? null,
        input.projectPlan === undefined ? null : JSON.stringify(input.projectPlan),
        input.platformCheckStatus ?? null,
      ],
    );
    return result.rows[0] ? mapVersion(result.rows[0]) : null;
  }
}
