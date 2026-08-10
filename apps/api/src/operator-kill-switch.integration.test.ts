import { createHash } from "node:crypto";

import type { ArtifactFile, DeployableArtifact } from "@pocketcloud/core";
import { VercelDeploymentProvider } from "@pocketcloud/deployment";
import { MemoryPrivateObjectStorage } from "@pocketcloud/platform";
import {
  createMigratedTestDatabase,
  type PGliteTestDatabase,
} from "@pocketcloud/platform/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./build-app";

const runLiveKillSwitch = process.env.POCKETCLOUD_RUN_LIVE_KILL_SWITCH === "1";

function tinyArtifact(): DeployableArtifact {
  const bytes = new TextEncoder().encode(
    "<!doctype html><title>PocketCloud kill-switch fixture</title>",
  );
  const file: ArtifactFile = {
    path: "index.html",
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType: "text/html",
  };
  return {
    manifest: {
      schemaVersion: 1,
      artifactId: `pc-303-kill-switch-${Date.now()}`,
      kind: "normalized",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      totalBytes: bytes.byteLength,
      fileCount: 1,
      files: [file],
      createdAt: new Date().toISOString(),
    },
    files: { async *read() { yield bytes; } },
    idempotencyKey: `pc-303-kill-switch-${Date.now()}`,
  };
}

describe.skipIf(!runLiveKillSwitch)("PC-303 live operator kill switch", () => {
  let database: PGliteTestDatabase;
  let provider: VercelDeploymentProvider;
  let providerDeploymentId: string | undefined;

  beforeAll(async () => {
    const token = process.env.VERCEL_TOKEN;
    if (!token) throw new Error("VERCEL_TOKEN is required for the opt-in kill-switch test");
    database = await createMigratedTestDatabase();
    provider = new VercelDeploymentProvider({
      token,
      projectName: process.env.VERCEL_PROJECT_NAME ?? "pocketcloud-integration",
      ...(process.env.VERCEL_PROJECT_ID ? { projectId: process.env.VERCEL_PROJECT_ID } : {}),
      ...(process.env.VERCEL_TEAM_ID ? { teamId: process.env.VERCEL_TEAM_ID } : {}),
    });
  });

  afterAll(async () => {
    if (providerDeploymentId) await provider.remove(providerDeploymentId);
    await database.close();
  });

  it("suspends the app and removes its real test deployment", async () => {
    const live = await provider.deploy(tinyArtifact());
    providerDeploymentId = live.providerDeploymentId;
    if (!live.candidateUrl) throw new Error("Vercel did not return a candidate URL");
    await database.query(
      `INSERT INTO apps (id, actor_key, name, slug)
       VALUES ('app-live-kill-switch', 'actor-live', 'Live kill switch', 'live-kill-switch')`,
    );
    await database.query(
      `INSERT INTO app_versions (id, app_id, sequence, platform_check_status)
       VALUES ('version-live-kill-switch', 'app-live-kill-switch', 1, 'DEPLOYED')`,
    );
    await database.query(
      `UPDATE apps SET active_version_id = 'version-live-kill-switch'
       WHERE id = 'app-live-kill-switch'`,
    );
    await database.query(
      `INSERT INTO deployments (
         id, actor_key, app_id, version_id, status, provider, provider_deployment_id,
         public_url, idempotency_key, finished_at
       ) VALUES (
         'deployment-live-kill-switch', 'actor-live', 'app-live-kill-switch',
         'version-live-kill-switch', 'READY', 'vercel', $1, $2, 'live-kill-switch', now()
       )`,
      [live.providerDeploymentId, live.candidateUrl],
    );
    const app = buildApi({
      database,
      storage: new MemoryPrivateObjectStorage(),
      actorHashSecret: "test-secret-that-is-long-enough-for-hmac",
      operator: {
        apiKey: "test-operator-key-that-is-long-enough",
        deploymentProvider: provider,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/operator/apps/app-live-kill-switch/suspend",
      headers: {
        "x-pocketcloud-operator-key": "test-operator-key-that-is-long-enough",
        "x-pocketcloud-operator-id": "pilot-operator@example.com",
      },
      payload: { reason: "PC-303 controlled live kill-switch verification" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      appStatus: "SUSPENDED",
      affectedDeployments: 1,
    });
    await expect(provider.remove(live.providerDeploymentId)).resolves.toBeUndefined();
    providerDeploymentId = undefined;
  }, 120_000);
});
