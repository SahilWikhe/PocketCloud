import type { PocketCloudErrorCode } from "@pocketcloud/core";

import type { SqlExecutor } from "./client";
import type { DeploymentJobRecord, JobStatus } from "./models";
import { toIso, toOptionalIso } from "./models";

interface JobRow {
  id: string;
  deployment_id: string;
  status: JobStatus;
  attempt: number;
  max_attempts: number;
  available_at: string | Date;
  claimed_by: string | null;
  claim_expires_at: string | Date | null;
  last_error_code: PocketCloudErrorCode | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapJob(row: JobRow): DeploymentJobRecord {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    availableAt: toIso(row.available_at),
    claimedBy: row.claimed_by,
    claimExpiresAt: toOptionalIso(row.claim_expires_at),
    lastErrorCode: row.last_error_code,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class DeploymentJobRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async enqueue(input: {
    id: string;
    deploymentId: string;
    maxAttempts?: number;
  }): Promise<DeploymentJobRecord> {
    const result = await this.sql.query<JobRow>(
      `INSERT INTO deployment_jobs (id, deployment_id, max_attempts)
       VALUES ($1, $2, $3)
       ON CONFLICT (deployment_id) DO UPDATE SET deployment_id = EXCLUDED.deployment_id
       RETURNING *`,
      [input.id, input.deploymentId, input.maxAttempts ?? 3],
    );
    return mapJob(result.rows[0]!);
  }

  async claimNext(input: {
    workerId: string;
    leaseSeconds: number;
    globalConcurrency?: number;
  }): Promise<DeploymentJobRecord | null> {
    const result = await this.sql.query<JobRow>(
      `WITH candidate AS (
         SELECT job.id
         FROM deployment_jobs AS job
         JOIN deployments AS deployment ON deployment.id = job.deployment_id
         JOIN apps AS app ON app.id = deployment.app_id
         WHERE (
           (job.status = 'QUEUED' AND job.available_at <= now())
           OR (job.status = 'CLAIMED' AND job.claim_expires_at <= now())
         )
         AND job.attempt < job.max_attempts
         AND deployment.status IN ('QUEUED', 'CLAIMED')
         AND app.status = 'ACTIVE'
         AND (
           SELECT COUNT(*)
           FROM deployment_jobs AS active_job
           WHERE active_job.status = 'CLAIMED' AND active_job.claim_expires_at > now()
         ) < $3
         AND NOT EXISTS (
           SELECT 1
           FROM deployment_jobs AS actor_job
           JOIN deployments AS actor_deployment ON actor_deployment.id = actor_job.deployment_id
           WHERE actor_job.status = 'CLAIMED'
             AND actor_job.claim_expires_at > now()
             AND actor_deployment.actor_key = deployment.actor_key
         )
         ORDER BY job.available_at, job.created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE deployment_jobs AS job
       SET status = 'CLAIMED',
           attempt = job.attempt + 1,
           claimed_by = $1,
           claim_expires_at = now() + ($2 * interval '1 second'),
           updated_at = now()
       FROM candidate
       WHERE job.id = candidate.id
       RETURNING job.*`,
      [input.workerId, input.leaseSeconds, input.globalConcurrency ?? 3],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async heartbeat(input: {
    jobId: string;
    workerId: string;
    leaseSeconds: number;
  }): Promise<boolean> {
    const result = await this.sql.query(
      `UPDATE deployment_jobs
       SET claim_expires_at = now() + ($3 * interval '1 second'), updated_at = now()
       WHERE id = $1 AND status = 'CLAIMED' AND claimed_by = $2`,
      [input.jobId, input.workerId, input.leaseSeconds],
    );
    return result.rowCount === 1;
  }

  async complete(jobId: string, workerId: string): Promise<boolean> {
    const result = await this.sql.query(
      `UPDATE deployment_jobs
       SET status = 'COMPLETED', claim_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND status = 'CLAIMED' AND claimed_by = $2`,
      [jobId, workerId],
    );
    return result.rowCount === 1;
  }

  async retry(input: {
    jobId: string;
    workerId: string;
    errorCode: PocketCloudErrorCode;
    delaySeconds: number;
  }): Promise<boolean> {
    const result = await this.sql.query(
      `UPDATE deployment_jobs
       SET status = CASE WHEN attempt < max_attempts THEN 'QUEUED' ELSE 'FAILED' END,
           available_at = now() + ($4 * interval '1 second'),
           claimed_by = NULL,
           claim_expires_at = NULL,
           last_error_code = $3,
           updated_at = now()
       WHERE id = $1 AND status = 'CLAIMED' AND claimed_by = $2`,
      [input.jobId, input.workerId, input.errorCode, input.delaySeconds],
    );
    return result.rowCount === 1;
  }

  async cancelForApp(appId: string): Promise<number> {
    const result = await this.sql.query(
      `UPDATE deployment_jobs AS job
       SET status = 'CANCELLED', claimed_by = NULL, claim_expires_at = NULL, updated_at = now()
       FROM deployments AS deployment
       WHERE job.deployment_id = deployment.id
         AND deployment.app_id = $1
         AND job.status IN ('QUEUED', 'CLAIMED')`,
      [appId],
    );
    return result.rowCount;
  }
}
