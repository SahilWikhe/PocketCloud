import type { UsageMetric } from "@pocketcloud/core";

import type { SqlExecutor } from "./client";
import type { UsageEventRecord } from "./models";
import { toIso } from "./models";

interface UsageRow {
  id: string;
  actor_key: string;
  deployment_id: string | null;
  metric: UsageMetric | "deployment";
  quantity: string | number;
  provider: string | null;
  created_at: string | Date;
}

function mapUsage(row: UsageRow): UsageEventRecord {
  return {
    id: row.id,
    actorKey: row.actor_key,
    deploymentId: row.deployment_id,
    metric: row.metric,
    quantity: Number(row.quantity),
    provider: row.provider,
    createdAt: toIso(row.created_at),
  };
}

export class UsageRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async record(input: {
    id: string;
    actorKey: string;
    deploymentId?: string;
    metric: UsageMetric | "deployment";
    quantity: number;
    provider?: string;
  }): Promise<UsageEventRecord> {
    const result = await this.sql.query<UsageRow>(
      `INSERT INTO usage_events (id, actor_key, deployment_id, metric, quantity, provider)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.id,
        input.actorKey,
        input.deploymentId ?? null,
        input.metric,
        input.quantity,
        input.provider ?? null,
      ],
    );
    return mapUsage(result.rows[0]!);
  }
}

export interface QuotaSnapshot {
  hourlyDeployments: number;
  dailyDeployments: number;
  activeDeployments: number;
}

export class QuotaRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async lockActor(actorKey: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO quota_scopes (actor_key)
       VALUES ($1)
       ON CONFLICT (actor_key)
       DO UPDATE SET updated_at = now()`,
      [actorKey],
    );
  }

  async snapshot(actorKey: string): Promise<QuotaSnapshot> {
    const result = await this.sql.query<{
      hourly_deployments: string | number;
      daily_deployments: string | number;
      active_deployments: string | number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= now() - interval '1 hour') AS hourly_deployments,
         COUNT(*) FILTER (WHERE created_at >= now() - interval '1 day') AS daily_deployments,
         COUNT(*) FILTER (WHERE status NOT IN ('READY', 'FAILED', 'CANCELLED', 'SUSPENDED')) AS active_deployments
       FROM deployments
       WHERE actor_key = $1`,
      [actorKey],
    );
    const snapshot = result.rows[0]!;
    return {
      hourlyDeployments: Number(snapshot.hourly_deployments),
      dailyDeployments: Number(snapshot.daily_deployments),
      activeDeployments: Number(snapshot.active_deployments),
    };
  }
}
