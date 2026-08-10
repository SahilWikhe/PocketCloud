import { afterEach, describe, expect, it } from "vitest";

import { createMigratedTestDatabase, type PGliteTestDatabase } from "../testing/pglite";
import { OperationalMetricsRepository } from "./operations";

describe("pilot operational metrics", () => {
  let database: PGliteTestDatabase | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it("reports queue, failures, Sandbox, AI, storage, suspension, and cleanup signals", async () => {
    database = await createMigratedTestDatabase();
    const now = new Date("2026-08-09T20:00:00.000Z");
    await database.query(
      `INSERT INTO apps (id, actor_key, name, slug, status) VALUES
         ('app-suspended', 'actor-1', 'Suspended', 'suspended', 'SUSPENDED'),
         ('app-active', 'actor-2', 'Active', 'active', 'ACTIVE');
       INSERT INTO artifacts (
         id, kind, storage_provider, storage_key, sha256, compressed_bytes, status, expires_at
       ) VALUES (
         'artifact-quarantine', 'original', 'memory', 'quarantine/upload.zip',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 2048,
         'QUARANTINED', '2026-08-10T00:00:00.000Z'
       );
       INSERT INTO app_versions (id, app_id, sequence) VALUES
         ('version-failed', 'app-suspended', 1),
         ('version-active', 'app-active', 1),
         ('version-queued', 'app-active', 2);
       INSERT INTO deployments (
         id, actor_key, app_id, version_id, status, idempotency_key,
         error_code, error_summary, error_retryable, finished_at, created_at
       ) VALUES
         ('deployment-failed', 'actor-1', 'app-suspended', 'version-failed', 'FAILED',
          'failed-once', 'PROVIDER_DEPLOYMENT_FAILED', 'internal only', false,
          '2026-08-09T19:30:00.000Z', '2026-08-09T19:00:00.000Z'),
         ('deployment-active', 'actor-2', 'app-active', 'version-active', 'ANALYZING',
          'active-once', NULL, NULL, NULL, NULL, '2026-08-09T19:40:00.000Z'),
         ('deployment-queued', 'actor-2', 'app-active', 'version-queued', 'QUEUED',
          'queued-once', NULL, NULL, NULL, NULL, '2026-08-09T19:45:00.000Z');
       INSERT INTO deployment_jobs (
         id, deployment_id, status, attempt, max_attempts, available_at,
         claimed_by, claim_expires_at, created_at
       ) VALUES
         ('job-active', 'deployment-active', 'CLAIMED', 1, 3, '2026-08-09T19:40:00.000Z',
          'worker-1', '2026-08-09T20:01:00.000Z', '2026-08-09T19:40:00.000Z'),
         ('job-queued', 'deployment-queued', 'QUEUED', 0, 3, '2026-08-09T19:45:00.000Z',
          NULL, NULL, '2026-08-09T19:45:00.000Z');
       INSERT INTO usage_events (id, actor_key, deployment_id, metric, quantity, provider, created_at)
       VALUES
         ('usage-ai-in', 'actor-2', 'deployment-active', 'ai_input_tokens', 1200, 'openai', '2026-08-09T20:00:00.000Z'),
         ('usage-ai-out', 'actor-2', 'deployment-active', 'ai_output_tokens', 200, 'openai', '2026-08-09T20:00:00.000Z'),
         ('usage-sandbox', 'actor-2', 'deployment-active', 'sandbox_creation', 1, 'vercel', '2026-08-09T20:00:00.000Z'),
         ('usage-sandbox-time', 'actor-2', 'deployment-active', 'sandbox_active_milliseconds', 4500, 'vercel', '2026-08-09T20:00:00.000Z'),
         ('usage-provider', 'actor-2', 'deployment-active', 'provider_deployment', 1, 'vercel', '2026-08-09T20:00:00.000Z'),
         ('usage-upload', 'actor-2', NULL, 'upload_bytes', 2048, NULL, '2026-08-09T20:00:00.000Z');
       INSERT INTO deployment_events (
         id, deployment_id, sequence, type, code, customer_message, created_at
       ) VALUES (
         'event-cleanup', 'deployment-failed', 1, 'warning', 'CLEANUP_FAILED',
         'Operator review required', '2026-08-09T20:00:00.000Z'
       );
       INSERT INTO deployment_event_counters (deployment_id, next_sequence)
       VALUES ('deployment-failed', 2);
       INSERT INTO upload_intents (
         id, actor_key, version_id, planned_artifact_id, storage_key, expected_sha256,
         expected_bytes, content_type, status, expires_at, created_at
       ) VALUES (
         'upload-rejected', 'actor-2', 'version-queued', 'planned-rejected',
         'quarantine/rejected.zip',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         1, 'application/zip', 'REJECTED',
         '2026-08-09T19:50:00.000Z', '2026-08-09T20:00:00.000Z'
       );
       INSERT INTO operator_actions (
         id, app_id, operator_actor, action, reason, provider_cleanup_status,
         provider_cleanup_error, created_at, completed_at
       ) VALUES (
         'operator-cleanup', 'app-suspended', 'operator@example.com', 'SUSPEND',
         'Pilot test', 'FAILED', 'internal only',
         '2026-08-09T20:00:00.000Z', '2026-08-09T20:00:00.000Z'
       )`,
    );

    const snapshot = await new OperationalMetricsRepository(database).snapshot(now);
    expect(snapshot.queue).toEqual({
      queued: 1,
      claimed: 1,
      oldestQueuedAt: "2026-08-09T19:45:00.000Z",
      oldestQueuedAgeSeconds: 900,
    });
    expect(snapshot.activeSandboxes).toBe(1);
    expect(snapshot.failuresLast24Hours).toContainEqual({
      code: "PROVIDER_DEPLOYMENT_FAILED",
      count: 1,
    });
    expect(snapshot.usageToday).toEqual({
      uploadBytes: 2048,
      sandboxCreations: 1,
      sandboxActiveMilliseconds: 4500,
      aiInputTokens: 1200,
      aiOutputTokens: 200,
      providerDeployments: 1,
    });
    expect(snapshot.storage).toEqual({
      retainedArtifacts: 1,
      retainedBytes: 2048,
      quarantinedArtifacts: 1,
      quarantinedBytes: 2048,
    });
    expect(snapshot.rejectedUploadsLast24Hours).toBe(1);
    expect(snapshot.suspendedApps).toBe(1);
    expect(snapshot.cleanupFailuresLast24Hours).toBe(2);
  });
});
