import {
  deploymentJobV1Schema,
  type DeploymentJobV1,
  type PocketCloudErrorCode,
} from "@pocketcloud/core";

import type { TransactionalSqlExecutor } from "../database/client";
import { DeploymentJobRepository } from "../database/jobs";

export interface ClaimedDeploymentJob {
  job: DeploymentJobV1;
  workerId: string;
  claimExpiresAt: string;
}

export class PostgresDeploymentQueue {
  constructor(
    private readonly database: TransactionalSqlExecutor,
    private readonly globalConcurrency = 3,
  ) {}

  async claim(workerId: string, leaseSeconds = 30): Promise<ClaimedDeploymentJob | null> {
    return this.claimJob(workerId, leaseSeconds);
  }

  async claimDeployment(
    deploymentId: string,
    workerId: string,
    leaseSeconds = 30,
  ): Promise<ClaimedDeploymentJob | null> {
    return this.claimJob(workerId, leaseSeconds, deploymentId);
  }

  private async claimJob(
    workerId: string,
    leaseSeconds: number,
    deploymentId?: string,
  ): Promise<ClaimedDeploymentJob | null> {
    return this.database.transaction(async (transaction) => {
      const claimed = await new DeploymentJobRepository(transaction).claimNext({
        workerId,
        leaseSeconds,
        globalConcurrency: this.globalConcurrency,
        ...(deploymentId === undefined ? {} : { deploymentId }),
      });
      if (!claimed || !claimed.claimExpiresAt) {
        return null;
      }
      const result = await transaction.query<{
        app_id: string;
        version_id: string;
        original_artifact_id: string | null;
        created_at: string | Date;
      }>(
        `SELECT deployment.app_id, deployment.version_id,
                version.original_artifact_id, job.created_at
         FROM deployment_jobs AS job
         JOIN deployments AS deployment ON deployment.id = job.deployment_id
         JOIN app_versions AS version ON version.id = deployment.version_id
         WHERE job.id = $1`,
        [claimed.id],
      );
      const payload = result.rows[0];
      if (!payload?.original_artifact_id) {
        throw new Error("Claimed deployment job has no sealed original artifact");
      }
      return {
        job: deploymentJobV1Schema.parse({
          schemaVersion: 1,
          jobId: claimed.id,
          deploymentId: claimed.deploymentId,
          appId: payload.app_id,
          versionId: payload.version_id,
          originalArtifactId: payload.original_artifact_id,
          correlationId: claimed.deploymentId,
          attempt: claimed.attempt,
          maxAttempts: claimed.maxAttempts,
          requestedAt: new Date(payload.created_at).toISOString(),
        }),
        workerId,
        claimExpiresAt: claimed.claimExpiresAt,
      };
    });
  }

  heartbeat(jobId: string, workerId: string, leaseSeconds = 30): Promise<boolean> {
    return new DeploymentJobRepository(this.database).heartbeat({ jobId, workerId, leaseSeconds });
  }

  complete(jobId: string, workerId: string): Promise<boolean> {
    return new DeploymentJobRepository(this.database).complete(jobId, workerId);
  }

  retry(input: {
    jobId: string;
    workerId: string;
    errorCode: PocketCloudErrorCode;
    delaySeconds: number;
  }): Promise<boolean> {
    return new DeploymentJobRepository(this.database).retry(input);
  }

  fail(input: {
    jobId: string;
    workerId: string;
    errorCode: PocketCloudErrorCode;
  }): Promise<boolean> {
    return new DeploymentJobRepository(this.database).fail(input);
  }

  cancel(jobId: string, workerId: string): Promise<boolean> {
    return new DeploymentJobRepository(this.database).cancel(jobId, workerId);
  }
}
