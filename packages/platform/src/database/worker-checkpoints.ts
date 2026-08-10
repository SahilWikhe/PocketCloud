import type { SqlExecutor } from "./client";

interface WorkerCheckpointRow {
  checkpoint: unknown;
}

export class DeploymentWorkerCheckpointRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async load(deploymentId: string): Promise<unknown | null> {
    const result = await this.sql.query<WorkerCheckpointRow>(
      "SELECT checkpoint FROM deployment_worker_checkpoints WHERE deployment_id = $1",
      [deploymentId],
    );
    return result.rows[0]?.checkpoint ?? null;
  }

  async save(deploymentId: string, checkpoint: unknown): Promise<void> {
    await this.sql.query(
      `INSERT INTO deployment_worker_checkpoints (deployment_id, checkpoint)
       VALUES ($1, $2)
       ON CONFLICT (deployment_id)
       DO UPDATE SET checkpoint = EXCLUDED.checkpoint, updated_at = now()`,
      [deploymentId, JSON.stringify(checkpoint)],
    );
  }
}
