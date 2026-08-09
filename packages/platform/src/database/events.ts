import type { DeploymentEventV1 } from "@pocketcloud/core";

import type { SqlExecutor } from "./client";
import type { PersistedDeploymentEvent } from "./models";
import { toIso } from "./models";

interface EventRow {
  id: string;
  deployment_id: string;
  sequence: number;
  type: DeploymentEventV1["type"];
  code: string;
  customer_message: string;
  internal_metadata: Record<string, unknown> | null;
  created_at: string | Date;
}

function mapEvent(row: EventRow): PersistedDeploymentEvent {
  return {
    schemaVersion: 1,
    id: row.id,
    deploymentId: row.deployment_id,
    sequence: row.sequence,
    type: row.type,
    code: row.code,
    customerMessage: row.customer_message,
    ...(row.internal_metadata === null ? {} : { internalMetadata: row.internal_metadata }),
    occurredAt: toIso(row.created_at),
  };
}

export class DeploymentEventRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async append(input: {
    id: string;
    deploymentId: string;
    type: DeploymentEventV1["type"];
    code: string;
    customerMessage: string;
    internalMetadata?: Record<string, unknown>;
  }): Promise<PersistedDeploymentEvent> {
    const counter = await this.sql.query<{ sequence: number }>(
      `INSERT INTO deployment_event_counters (deployment_id, next_sequence)
       VALUES ($1, 2)
       ON CONFLICT (deployment_id)
       DO UPDATE SET next_sequence = deployment_event_counters.next_sequence + 1
       RETURNING next_sequence - 1 AS sequence`,
      [input.deploymentId],
    );
    const sequence = counter.rows[0]!.sequence;
    const result = await this.sql.query<EventRow>(
      `INSERT INTO deployment_events (
         id, deployment_id, sequence, type, code, customer_message, internal_metadata, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       RETURNING *`,
      [
        input.id,
        input.deploymentId,
        sequence,
        input.type,
        input.code,
        input.customerMessage,
        input.internalMetadata ? JSON.stringify(input.internalMetadata) : null,
      ],
    );
    return mapEvent(result.rows[0]!);
  }

  async listCustomerVisible(deploymentId: string): Promise<readonly PersistedDeploymentEvent[]> {
    const result = await this.sql.query<EventRow>(
      `SELECT id, deployment_id, sequence, type, code, customer_message,
              NULL::jsonb AS internal_metadata, created_at
       FROM deployment_events
       WHERE deployment_id = $1
       ORDER BY sequence`,
      [deploymentId],
    );
    return result.rows.map(mapEvent);
  }
}
