import type { NormalizationChangeV1 } from "@pocketcloud/core";

import type { SqlExecutor } from "./client";

interface ChangeRow {
  id: string;
  source: NormalizationChangeV1["source"];
  rule_code: string;
  operation: NormalizationChangeV1["operation"];
  path: string;
  previous_path: string | null;
  before_sha256: string | null;
  after_sha256: string | null;
  summary: string;
  requires_customer_attention: boolean;
}

function mapChange(row: ChangeRow): NormalizationChangeV1 {
  return {
    schemaVersion: 1,
    changeId: row.id,
    source: row.source,
    ruleCode: row.rule_code,
    operation: row.operation,
    path: row.path,
    ...(row.previous_path === null ? {} : { previousPath: row.previous_path }),
    ...(row.before_sha256 === null ? {} : { beforeSha256: row.before_sha256 }),
    ...(row.after_sha256 === null ? {} : { afterSha256: row.after_sha256 }),
    summary: row.summary,
    requiresCustomerAttention: row.requires_customer_attention,
  };
}

export class NormalizationChangeRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async listForVersion(versionId: string): Promise<readonly NormalizationChangeV1[]> {
    const result = await this.sql.query<ChangeRow>(
      `SELECT id, source, rule_code, operation, path, previous_path,
              before_sha256, after_sha256, summary, requires_customer_attention
       FROM normalization_changes
       WHERE version_id = $1
       ORDER BY created_at, id`,
      [versionId],
    );
    return result.rows.map(mapChange);
  }
}
