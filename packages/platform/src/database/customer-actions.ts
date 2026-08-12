import type { SqlExecutor } from "./client";
import type {
  AppStatus,
  CustomerAppAction,
  CustomerAppActionRecord,
  CustomerAppActionStatus,
  LifecycleProviderCleanupStatus,
} from "./models";
import { toIso, toOptionalIso } from "./models";

interface CustomerActionRow {
  id: string;
  workspace_id: string;
  user_id: string;
  app_id: string;
  action: CustomerAppAction;
  idempotency_key: string;
  status: CustomerAppActionStatus;
  resulting_app_status: AppStatus | null;
  deployment_id: string | null;
  recoverable_until: string | Date | null;
  provider_cleanup_status: LifecycleProviderCleanupStatus;
  failure_code: string | null;
  created_at: string | Date;
  completed_at: string | Date | null;
}

function mapAction(row: CustomerActionRow): CustomerAppActionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    appId: row.app_id,
    action: row.action,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    resultingAppStatus: row.resulting_app_status,
    deploymentId: row.deployment_id,
    recoverableUntil: toOptionalIso(row.recoverable_until),
    providerCleanupStatus: row.provider_cleanup_status,
    failureCode: row.failure_code,
    createdAt: toIso(row.created_at),
    completedAt: toOptionalIso(row.completed_at),
  };
}

export class CustomerAppActionRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async findByIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<CustomerAppActionRecord | null> {
    const result = await this.sql.query<CustomerActionRow>(
      `SELECT * FROM customer_app_actions
       WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey],
    );
    return result.rows[0] ? mapAction(result.rows[0]) : null;
  }

  async create(input: {
    id: string;
    workspaceId: string;
    userId: string;
    appId: string;
    action: CustomerAppAction;
    idempotencyKey: string;
    providerCleanupStatus?: LifecycleProviderCleanupStatus;
  }): Promise<CustomerAppActionRecord | null> {
    const result = await this.sql.query<CustomerActionRow>(
      `INSERT INTO customer_app_actions (
         id, workspace_id, user_id, app_id, action, idempotency_key, provider_cleanup_status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.userId,
        input.appId,
        input.action,
        input.idempotencyKey,
        input.providerCleanupStatus ?? "NOT_REQUIRED",
      ],
    );
    return result.rows[0] ? mapAction(result.rows[0]) : null;
  }

  async complete(input: {
    id: string;
    appStatus: AppStatus;
    deploymentId?: string;
    recoverableUntil?: string;
    providerCleanupStatus?: LifecycleProviderCleanupStatus;
  }): Promise<CustomerAppActionRecord> {
    const result = await this.sql.query<CustomerActionRow>(
      `UPDATE customer_app_actions
       SET status = 'COMPLETED',
           resulting_app_status = $2,
           deployment_id = $3,
           recoverable_until = $4::timestamptz,
           provider_cleanup_status = COALESCE($5, provider_cleanup_status),
           failure_code = NULL,
           completed_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        input.id,
        input.appStatus,
        input.deploymentId ?? null,
        input.recoverableUntil ?? null,
        input.providerCleanupStatus ?? null,
      ],
    );
    return mapAction(result.rows[0]!);
  }

  async recordOutcome(input: {
    id: string;
    appStatus: AppStatus;
    recoverableUntil?: string;
  }): Promise<CustomerAppActionRecord> {
    const result = await this.sql.query<CustomerActionRow>(
      `UPDATE customer_app_actions
       SET resulting_app_status = $2,
           recoverable_until = $3::timestamptz
       WHERE id = $1
       RETURNING *`,
      [input.id, input.appStatus, input.recoverableUntil ?? null],
    );
    return mapAction(result.rows[0]!);
  }

  async fail(id: string, failureCode: string): Promise<CustomerAppActionRecord> {
    const result = await this.sql.query<CustomerActionRow>(
      `UPDATE customer_app_actions
       SET status = 'FAILED',
           provider_cleanup_status = CASE
             WHEN provider_cleanup_status = 'PENDING' THEN 'FAILED'
             ELSE provider_cleanup_status
           END,
           failure_code = $2,
           completed_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, failureCode],
    );
    return mapAction(result.rows[0]!);
  }

  async listByWorkspace(
    workspaceId: string,
    limit = 100,
  ): Promise<readonly CustomerAppActionRecord[]> {
    const result = await this.sql.query<CustomerActionRow>(
      `SELECT * FROM customer_app_actions
       WHERE workspace_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [workspaceId, limit],
    );
    return result.rows.map(mapAction);
  }
}
