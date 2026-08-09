import type { SqlExecutor } from "./client";
import { toIso, toOptionalIso } from "./models";

export type OperatorActionKind = "SUSPEND" | "REENABLE";
export type ProviderCleanupStatus = "NOT_REQUIRED" | "PENDING" | "COMPLETED" | "FAILED";

export interface OperatorActionRecord {
  id: string;
  appId: string;
  operatorActor: string;
  action: OperatorActionKind;
  reason: string;
  providerCleanupStatus: ProviderCleanupStatus;
  providerCleanupError: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface OperatorActionRow {
  id: string;
  app_id: string;
  operator_actor: string;
  action: OperatorActionKind;
  reason: string;
  provider_cleanup_status: ProviderCleanupStatus;
  provider_cleanup_error: string | null;
  created_at: string | Date;
  completed_at: string | Date | null;
}

function mapAction(row: OperatorActionRow): OperatorActionRecord {
  return {
    id: row.id,
    appId: row.app_id,
    operatorActor: row.operator_actor,
    action: row.action,
    reason: row.reason,
    providerCleanupStatus: row.provider_cleanup_status,
    providerCleanupError: row.provider_cleanup_error,
    createdAt: toIso(row.created_at),
    completedAt: toOptionalIso(row.completed_at),
  };
}

export class OperatorActionRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async create(input: {
    id: string;
    appId: string;
    operatorActor: string;
    action: OperatorActionKind;
    reason: string;
    providerCleanupStatus: ProviderCleanupStatus;
  }): Promise<OperatorActionRecord> {
    const result = await this.sql.query<OperatorActionRow>(
      `INSERT INTO operator_actions (
         id, app_id, operator_actor, action, reason, provider_cleanup_status,
         completed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 IN ('NOT_REQUIRED', 'COMPLETED') THEN now() ELSE NULL END)
       RETURNING *`,
      [
        input.id,
        input.appId,
        input.operatorActor,
        input.action,
        input.reason,
        input.providerCleanupStatus,
      ],
    );
    return mapAction(result.rows[0]!);
  }

  async finishCleanup(
    id: string,
    status: "COMPLETED" | "FAILED",
    error?: string,
  ): Promise<OperatorActionRecord | null> {
    const result = await this.sql.query<OperatorActionRow>(
      `UPDATE operator_actions
       SET provider_cleanup_status = $2,
           provider_cleanup_error = $3,
           completed_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, status, error ?? null],
    );
    return result.rows[0] ? mapAction(result.rows[0]) : null;
  }

  async listForApp(appId: string): Promise<readonly OperatorActionRecord[]> {
    const result = await this.sql.query<OperatorActionRow>(
      "SELECT * FROM operator_actions WHERE app_id = $1 ORDER BY created_at, id",
      [appId],
    );
    return result.rows.map(mapAction);
  }
}
