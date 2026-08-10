import { deploymentStateSchema, type DeploymentState, type PocketCloudErrorCode } from "@pocketcloud/core";

import type { SqlExecutor } from "./client";
import { toIso } from "./models";

export interface OperationalCount {
  name: string;
  count: number;
}

export interface OperationalSnapshot {
  generatedAt: string;
  deploymentsByState: readonly OperationalCount[];
  queue: {
    queued: number;
    claimed: number;
    oldestQueuedAt: string | null;
    oldestQueuedAgeSeconds: number | null;
  };
  activeSandboxes: number;
  failuresLast24Hours: readonly { code: PocketCloudErrorCode; count: number }[];
  usageToday: {
    uploadBytes: number;
    sandboxCreations: number;
    sandboxActiveMilliseconds: number;
    aiInputTokens: number;
    aiOutputTokens: number;
    providerDeployments: number;
  };
  storage: {
    retainedArtifacts: number;
    retainedBytes: number;
    quarantinedArtifacts: number;
    quarantinedBytes: number;
  };
  rejectedUploadsLast24Hours: number;
  suspendedApps: number;
  cleanupFailuresLast24Hours: number;
}

function numeric(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

export class OperationalMetricsRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async snapshot(now = new Date()): Promise<OperationalSnapshot> {
    const generatedAt = now.toISOString();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const startOfToday = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    )).toISOString();

    const [states, queue, failures, usage, storage, counts] = await Promise.all([
      this.sql.query<{ status: DeploymentState; count: string | number }>(
        `SELECT status, COUNT(*) AS count
         FROM deployments
         GROUP BY status
         ORDER BY status`,
      ),
      this.sql.query<{
        queued: string | number;
        claimed: string | number;
        oldest_queued_at: string | Date | null;
        active_sandboxes: string | number;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE job.status = 'QUEUED') AS queued,
           COUNT(*) FILTER (
             WHERE job.status = 'CLAIMED' AND job.claim_expires_at > $1::timestamptz
           ) AS claimed,
           MIN(job.available_at) FILTER (WHERE job.status = 'QUEUED') AS oldest_queued_at,
           COUNT(*) FILTER (
             WHERE deployment.status IN (
               'SANDBOX_STARTING', 'ANALYZING', 'NORMALIZING', 'VALIDATING',
               'READY_TO_DEPLOY', 'DEPLOYING', 'VERIFYING'
             )
           ) AS active_sandboxes
         FROM deployment_jobs AS job
         JOIN deployments AS deployment ON deployment.id = job.deployment_id`,
        [generatedAt],
      ),
      this.sql.query<{ error_code: PocketCloudErrorCode; count: string | number }>(
        `SELECT error_code, COUNT(*) AS count
         FROM deployments
         WHERE status = 'FAILED'
           AND error_code IS NOT NULL
           AND finished_at >= $1::timestamptz
         GROUP BY error_code
         ORDER BY error_code`,
        [last24Hours],
      ),
      this.sql.query<{
        upload_bytes: string | number;
        sandbox_creations: string | number;
        sandbox_active_milliseconds: string | number;
        ai_input_tokens: string | number;
        ai_output_tokens: string | number;
        provider_deployments: string | number;
      }>(
        `SELECT
           COALESCE(SUM(quantity) FILTER (WHERE metric = 'upload_bytes'), 0) AS upload_bytes,
           COALESCE(SUM(quantity) FILTER (WHERE metric = 'sandbox_creation'), 0) AS sandbox_creations,
           COALESCE(SUM(quantity) FILTER (WHERE metric = 'sandbox_active_milliseconds'), 0) AS sandbox_active_milliseconds,
           COALESCE(SUM(quantity) FILTER (WHERE metric = 'ai_input_tokens'), 0) AS ai_input_tokens,
           COALESCE(SUM(quantity) FILTER (WHERE metric = 'ai_output_tokens'), 0) AS ai_output_tokens,
           COALESCE(SUM(quantity) FILTER (WHERE metric = 'provider_deployment'), 0) AS provider_deployments
         FROM usage_events
         WHERE created_at >= $1::timestamptz`,
        [startOfToday],
      ),
      this.sql.query<{
        retained_artifacts: string | number;
        retained_bytes: string | number;
        quarantined_artifacts: string | number;
        quarantined_bytes: string | number;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE status <> 'DELETED') AS retained_artifacts,
           COALESCE(SUM(compressed_bytes) FILTER (WHERE status <> 'DELETED'), 0) AS retained_bytes,
           COUNT(*) FILTER (WHERE status = 'QUARANTINED') AS quarantined_artifacts,
           COALESCE(SUM(compressed_bytes) FILTER (WHERE status = 'QUARANTINED'), 0) AS quarantined_bytes
         FROM artifacts`,
      ),
      this.sql.query<{
        rejected_uploads: string | number;
        suspended_apps: string | number;
        cleanup_failures: string | number;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM upload_intents
            WHERE status = 'REJECTED' AND created_at >= $1::timestamptz) AS rejected_uploads,
           (SELECT COUNT(*) FROM apps WHERE status = 'SUSPENDED') AS suspended_apps,
           (
             (SELECT COUNT(*) FROM deployment_events
              WHERE code = 'CLEANUP_FAILED' AND created_at >= $1::timestamptz)
             +
             (SELECT COUNT(*) FROM operator_actions
              WHERE provider_cleanup_status = 'FAILED' AND created_at >= $1::timestamptz)
           ) AS cleanup_failures`,
        [last24Hours],
      ),
    ]);

    const queueRow = queue.rows[0]!;
    const usageRow = usage.rows[0]!;
    const storageRow = storage.rows[0]!;
    const countRow = counts.rows[0]!;
    const oldestQueuedAt = queueRow.oldest_queued_at === null
      ? null
      : toIso(queueRow.oldest_queued_at);

    return {
      generatedAt,
      deploymentsByState: states.rows.map((row) => ({
        name: deploymentStateSchema.parse(row.status),
        count: numeric(row.count),
      })),
      queue: {
        queued: numeric(queueRow.queued),
        claimed: numeric(queueRow.claimed),
        oldestQueuedAt,
        oldestQueuedAgeSeconds: oldestQueuedAt === null
          ? null
          : Math.max(0, Math.floor((now.getTime() - Date.parse(oldestQueuedAt)) / 1_000)),
      },
      activeSandboxes: numeric(queueRow.active_sandboxes),
      failuresLast24Hours: failures.rows.map((row) => ({
        code: row.error_code,
        count: numeric(row.count),
      })),
      usageToday: {
        uploadBytes: numeric(usageRow.upload_bytes),
        sandboxCreations: numeric(usageRow.sandbox_creations),
        sandboxActiveMilliseconds: numeric(usageRow.sandbox_active_milliseconds),
        aiInputTokens: numeric(usageRow.ai_input_tokens),
        aiOutputTokens: numeric(usageRow.ai_output_tokens),
        providerDeployments: numeric(usageRow.provider_deployments),
      },
      storage: {
        retainedArtifacts: numeric(storageRow.retained_artifacts),
        retainedBytes: numeric(storageRow.retained_bytes),
        quarantinedArtifacts: numeric(storageRow.quarantined_artifacts),
        quarantinedBytes: numeric(storageRow.quarantined_bytes),
      },
      rejectedUploadsLast24Hours: numeric(countRow.rejected_uploads),
      suspendedApps: numeric(countRow.suspended_apps),
      cleanupFailuresLast24Hours: numeric(countRow.cleanup_failures),
    };
  }
}
