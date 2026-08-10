import {
  assertDeploymentTransition,
  deploymentStateSchema,
  type DeploymentState,
  type PocketCloudErrorCode,
} from "@pocketcloud/core";

import type { SqlExecutor } from "./client";
import type { DeploymentRecord } from "./models";
import { toIso, toOptionalIso } from "./models";

interface DeploymentRow {
  id: string;
  actor_key: string;
  app_id: string;
  version_id: string;
  status: string;
  provider: string;
  provider_project_id: string | null;
  provider_deployment_id: string | null;
  public_url: string | null;
  idempotency_key: string;
  error_code: PocketCloudErrorCode | null;
  error_summary: string | null;
  error_retryable: boolean | null;
  error_retry_after_seconds: number | null;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapDeployment(row: DeploymentRow): DeploymentRecord {
  return {
    id: row.id,
    actorKey: row.actor_key,
    appId: row.app_id,
    versionId: row.version_id,
    status: deploymentStateSchema.parse(row.status),
    provider: row.provider,
    providerProjectId: row.provider_project_id,
    providerDeploymentId: row.provider_deployment_id,
    publicUrl: row.public_url,
    idempotencyKey: row.idempotency_key,
    errorCode: row.error_code,
    errorSummary: row.error_summary,
    errorRetryable: row.error_retryable,
    errorRetryAfterSeconds: row.error_retry_after_seconds,
    startedAt: toOptionalIso(row.started_at),
    finishedAt: toOptionalIso(row.finished_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class DeploymentRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async create(input: {
    id: string;
    actorKey: string;
    appId: string;
    versionId: string;
    idempotencyKey: string;
    initialState?: DeploymentState;
  }): Promise<DeploymentRecord> {
    const result = await this.sql.query<DeploymentRow>(
      `INSERT INTO deployments (
         id, actor_key, app_id, version_id, status, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.id,
        input.actorKey,
        input.appId,
        input.versionId,
        input.initialState ?? "QUARANTINED",
        input.idempotencyKey,
      ],
    );
    return mapDeployment(result.rows[0]!);
  }

  async findById(id: string): Promise<DeploymentRecord | null> {
    const result = await this.sql.query<DeploymentRow>(
      "SELECT * FROM deployments WHERE id = $1",
      [id],
    );
    return result.rows[0] ? mapDeployment(result.rows[0]) : null;
  }

  async findByIdForUpdate(id: string): Promise<DeploymentRecord | null> {
    const result = await this.sql.query<DeploymentRow>(
      "SELECT * FROM deployments WHERE id = $1 FOR UPDATE",
      [id],
    );
    return result.rows[0] ? mapDeployment(result.rows[0]) : null;
  }

  async findByIdempotencyKey(
    actorKey: string,
    idempotencyKey: string,
  ): Promise<DeploymentRecord | null> {
    const result = await this.sql.query<DeploymentRow>(
      "SELECT * FROM deployments WHERE actor_key = $1 AND idempotency_key = $2",
      [actorKey, idempotencyKey],
    );
    return result.rows[0] ? mapDeployment(result.rows[0]) : null;
  }

  async transition(input: {
    id: string;
    to: DeploymentState;
    operatorSuspension?: boolean;
    errorCode?: PocketCloudErrorCode;
    errorSummary?: string;
    errorRetryable?: boolean;
    errorRetryAfterSeconds?: number;
  }): Promise<DeploymentRecord | null> {
    const locked = await this.sql.query<DeploymentRow>(
      "SELECT * FROM deployments WHERE id = $1 FOR UPDATE",
      [input.id],
    );
    const current = locked.rows[0];
    if (!current) {
      return null;
    }
    const currentState = deploymentStateSchema.parse(current.status);
    if (currentState === input.to) {
      return mapDeployment(current);
    }
    assertDeploymentTransition(currentState, input.to, {
      ...(input.operatorSuspension === undefined
        ? {}
        : { operatorSuspension: input.operatorSuspension }),
    });

    const terminal = ["READY", "FAILED", "CANCELLED", "SUSPENDED"].includes(input.to);
    const result = await this.sql.query<DeploymentRow>(
      `UPDATE deployments
       SET status = $2,
           error_code = $3,
           error_summary = $4,
           error_retryable = $5,
           error_retry_after_seconds = $6,
           public_url = CASE WHEN $2 = 'SUSPENDED' THEN NULL ELSE public_url END,
           started_at = CASE WHEN started_at IS NULL AND $2 = 'CLAIMED' THEN now() ELSE started_at END,
           finished_at = CASE WHEN $7 THEN now() ELSE finished_at END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        input.id,
        input.to,
        input.errorCode ?? null,
        input.errorSummary ?? null,
        input.errorRetryable ?? null,
        input.errorRetryAfterSeconds ?? null,
        terminal,
      ],
    );
    return mapDeployment(result.rows[0]!);
  }

  async listSuspendableForApp(appId: string): Promise<readonly DeploymentRecord[]> {
    const result = await this.sql.query<DeploymentRow>(
      `SELECT * FROM deployments
       WHERE app_id = $1 AND status NOT IN ('FAILED', 'CANCELLED', 'SUSPENDED')
       ORDER BY created_at
       FOR UPDATE`,
      [appId],
    );
    return result.rows.map(mapDeployment);
  }

  async setProviderResult(input: {
    id: string;
    providerProjectId?: string;
    providerDeploymentId: string;
    publicUrl?: string;
  }): Promise<DeploymentRecord | null> {
    const result = await this.sql.query<DeploymentRow>(
      `UPDATE deployments
       SET provider_project_id = COALESCE($2, provider_project_id),
           provider_deployment_id = $3,
           public_url = COALESCE($4, public_url),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        input.id,
        input.providerProjectId ?? null,
        input.providerDeploymentId,
        input.publicUrl ?? null,
      ],
    );
    return result.rows[0] ? mapDeployment(result.rows[0]) : null;
  }
}
