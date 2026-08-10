import { createHash } from "node:crypto";

import {
  createUploadIntentV1Schema,
  deploymentCreatedV1Schema,
  deploymentStatusV1Schema,
  uploadIntentV1Schema,
  type DeploymentProvider,
  type ExecutionProvider,
} from "@pocketcloud/core";
import {
  AppRepository,
  DeploymentRepository,
  MemoryPrivateObjectStorage,
  PlatformArtifactStore,
  VersionRepository,
} from "@pocketcloud/platform";
import {
  createMigratedTestDatabase,
  type PGliteTestDatabase,
} from "@pocketcloud/platform/testing";
import { createDeploymentWorker } from "@pocketcloud/worker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./build-app";

// @ts-expect-error PC-200 intentionally provides a dependency-free ESM ZIP fixture builder.
import { createZip } from "../../../tests/sample-apps/archive-fixtures.mjs";

const actorHeaders = { "x-pocketcloud-actor": "pc-301-browser" };
const actorHashSecret = "pc-301-test-secret-that-is-long-enough";
const verifiedUrl = "https://live.pc-301.example.com";
const candidateUrl = "https://candidate.pc-301.example.com";
const productionCredential = "production-provider-secret-never-sent-to-sandbox";

function validStaticArchive(): Uint8Array {
  return createZip([
    {
      name: "site/index.html",
      bytes: new TextEncoder().encode(
        "<!doctype html><html><head><link rel=\"stylesheet\" href=\"styles.css\"></head><body><h1>PocketCloud</h1></body></html>",
      ),
    },
    {
      name: "site/styles.css",
      bytes: new TextEncoder().encode("body { font-family: sans-serif; }"),
    },
  ]) as Uint8Array;
}

describe("PC-301 end-to-end deployment flow", () => {
  let database: PGliteTestDatabase;
  let storage: MemoryPrivateObjectStorage;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    storage = new MemoryPrivateObjectStorage();
  });

  afterEach(async () => {
    await database.close();
  });

  it("connects upload, durable job, worker, verified READY status, and reconnect idempotently", async () => {
    const archive = validStaticArchive();
    const firstApi = buildApi({ database, storage, actorHashSecret });
    const intentResponse = await firstApi.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: actorHeaders,
      payload: createUploadIntentV1Schema.parse({
        schemaVersion: 1,
        appName: "PC-301 fixture",
        fileName: "site.zip",
        size: archive.byteLength,
        sha256: createHash("sha256").update(archive).digest("hex"),
      }),
    });
    expect(intentResponse.statusCode).toBe(201);
    const intent = uploadIntentV1Schema.parse(intentResponse.json());
    storage.put(intent.upload.pathname, archive);

    const completion = await firstApi.inject({
      method: "POST",
      url: `/v1/uploads/${intent.uploadId}/complete`,
      headers: actorHeaders,
    });
    expect(completion.statusCode).toBe(200);

    const deploymentRequest = {
      method: "POST" as const,
      url: "/v1/deployments",
      headers: { ...actorHeaders, "idempotency-key": "pc-301-deploy-once" },
      payload: { schemaVersion: 1, versionId: intent.versionId },
    };
    const firstCreate = await firstApi.inject(deploymentRequest);
    const duplicateCreate = await firstApi.inject(deploymentRequest);
    expect(firstCreate.statusCode).toBe(202);
    expect(duplicateCreate.json()).toEqual(firstCreate.json());
    const deployment = deploymentCreatedV1Schema.parse(firstCreate.json());
    await firstApi.close();

    const sandboxCreates = vi.fn(async () => ({
      environmentId: "sandbox-pc-301",
      createdAt: "2026-08-09T20:00:00.000Z",
    }));
    const sandboxWrites = vi.fn(async () => undefined);
    const sandboxStops = vi.fn(async () => undefined);
    const executionProvider = {
      create: sandboxCreates,
      writeFiles: sandboxWrites,
      run: vi.fn(async () => {
        throw new Error("Static PC-301 integration must not execute uploaded commands");
      }),
      readFiles: vi.fn(async () => []),
      stop: sandboxStops,
    } satisfies ExecutionProvider;

    const providerDeploys = vi.fn(async () => {
      void productionCredential;
      return {
        provider: "vercel",
        providerDeploymentId: "dpl_pc_301",
        providerProjectId: "prj_pc_301",
        candidateUrl,
      };
    });
    const deploymentProvider = {
      deploy: providerDeploys,
      getStatus: vi.fn(async () => "READY" as const),
      getLogs: vi.fn(async () => []),
      cancel: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    } satisfies DeploymentProvider;
    const worker = createDeploymentWorker({
      database,
      storage,
      executionProvider,
      deploymentProvider,
      workerId: "worker-pc-301",
      verify: async (url) => {
        expect(url).toBe(candidateUrl);
        return { publicUrl: verifiedUrl, status: 200, contentType: "text/html" };
      },
      wait: async () => undefined,
      heartbeatIntervalMilliseconds: 60_000,
    });

    await expect(worker.runOnce()).resolves.toEqual({
      status: "completed",
      deploymentId: deployment.deploymentId,
      publicUrl: verifiedUrl,
    });
    await expect(worker.runOnce()).resolves.toEqual({ status: "idle" });
    expect(providerDeploys).toHaveBeenCalledTimes(1);
    expect(sandboxCreates).toHaveBeenCalledTimes(1);
    expect(sandboxStops).toHaveBeenCalledWith("sandbox-pc-301");
    const sandboxBoundary = JSON.stringify([
      sandboxCreates.mock.calls,
      sandboxWrites.mock.calls,
    ]);
    expect(sandboxBoundary).not.toContain(productionCredential);
    expect(executionProvider.run).not.toHaveBeenCalled();

    const reconnectedApi = buildApi({ database, storage, actorHashSecret });
    const statusResponse = await reconnectedApi.inject({
      method: "GET",
      url: `/v1/deployments/${deployment.deploymentId}`,
      headers: actorHeaders,
    });
    const status = deploymentStatusV1Schema.parse(statusResponse.json());
    expect(status).toMatchObject({
      deploymentId: deployment.deploymentId,
      appId: intent.appId,
      versionId: intent.versionId,
      status: "READY",
      publicUrl: verifiedUrl,
      error: null,
    });
    expect(status.events.map((event) => event.code)).toEqual(
      expect.arrayContaining(["UPLOAD_RECEIVED", "PLATFORM_CHECKS_PASSED", "DEPLOYMENT_READY"]),
    );
    expect(status.changes).toHaveLength(2);
    expect(status.changes.every((change) => change.operation === "move")).toBe(true);

    const createAfterReconnect = await reconnectedApi.inject(deploymentRequest);
    expect(deploymentCreatedV1Schema.parse(createAfterReconnect.json())).toEqual({
      schemaVersion: 1,
      deploymentId: deployment.deploymentId,
      status: "READY",
    });
    await reconnectedApi.close();
    expect(providerDeploys).toHaveBeenCalledTimes(1);

    const storedDeployment = await new DeploymentRepository(database).findById(
      deployment.deploymentId,
    );
    expect(storedDeployment).toMatchObject({
      status: "READY",
      providerProjectId: "prj_pc_301",
      providerDeploymentId: "dpl_pc_301",
      publicUrl: verifiedUrl,
    });
    const version = await new VersionRepository(database).findById(intent.versionId);
    expect(version).toMatchObject({
      platformCheckStatus: "DEPLOYED",
      projectPlan: {
        schemaVersion: 1,
        kind: "static",
        projectRoot: "site",
        entrypoint: "site/index.html",
      },
    });
    expect(version?.normalizedArtifactId).toEqual(expect.any(String));
    expect(await new AppRepository(database).findById(intent.appId)).toMatchObject({
      activeVersionId: intent.versionId,
    });
    const normalizedManifest = await new PlatformArtifactStore({ database, storage }).getManifest(
      version!.normalizedArtifactId!,
    );
    expect(normalizedManifest).toMatchObject({
      kind: "normalized",
      fileCount: 2,
      files: expect.arrayContaining([expect.objectContaining({ path: "index.html" })]),
    });

    const jobs = await database.query<{ status: string; deployment_id: string }>(
      "SELECT status, deployment_id FROM deployment_jobs",
    );
    expect(jobs.rows).toEqual([
      { status: "COMPLETED", deployment_id: deployment.deploymentId },
    ]);
    const usage = await database.query<{ metric: string; quantity: string | number }>(
      `SELECT metric, quantity FROM usage_events
       WHERE deployment_id = $1
       ORDER BY metric`,
      [deployment.deploymentId],
    );
    expect(usage.rows.map((row) => row.metric)).toEqual(
      expect.arrayContaining([
        "deployment",
        "provider_deployment",
        "sandbox_active_milliseconds",
        "sandbox_creation",
        "sandbox_memory_gb_milliseconds",
      ]),
    );
    expect(usage.rows.filter((row) => row.metric === "provider_deployment")).toHaveLength(1);
  });
});
