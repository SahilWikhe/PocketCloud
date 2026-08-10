import { createHash } from "node:crypto";

import {
  createUploadIntentV1Schema,
  deploymentCreatedV1Schema,
  deploymentStatusV1Schema,
  uploadIntentV1Schema,
} from "@pocketcloud/core";
import {
  AppRepository,
  DeploymentEventRepository,
  DeploymentRepository,
  MemoryPrivateObjectStorage,
  OperatorActionRepository,
} from "@pocketcloud/platform";
import {
  createMigratedTestDatabase,
  type PGliteTestDatabase,
} from "@pocketcloud/platform/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./build-app";

const actorHeaders = { "x-pocketcloud-actor": "browser-123" };

describe("control-plane API", () => {
  let database: PGliteTestDatabase;
  let storage: MemoryPrivateObjectStorage;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    storage = new MemoryPrivateObjectStorage();
  });

  afterEach(async () => {
    await database.close();
  });

  async function upload(appName: string, content: Uint8Array) {
    const app = buildApi({
      database,
      storage,
      actorHashSecret: "test-secret-that-is-long-enough-for-hmac",
    });
    const intentResponse = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: actorHeaders,
      payload: createUploadIntentV1Schema.parse({
        schemaVersion: 1,
        appName,
        fileName: "site.zip",
        size: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
      }),
    });
    expect(intentResponse.statusCode).toBe(201);
    const intent = uploadIntentV1Schema.parse(intentResponse.json());
    storage.put(intent.upload.pathname, content);
    const completion = await app.inject({
      method: "POST",
      url: `/v1/uploads/${intent.uploadId}/complete`,
      headers: actorHeaders,
    });
    expect(completion.statusCode).toBe(200);
    return { app, intent, completion: completion.json() as unknown };
  }

  it("completes an immutable upload and creates one idempotent durable job", async () => {
    const uploaded = await upload("Launch page", new TextEncoder().encode("zip-bytes"));

    const duplicateCompletion = await uploaded.app.inject({
      method: "POST",
      url: `/v1/uploads/${uploaded.intent.uploadId}/complete`,
      headers: actorHeaders,
    });
    expect(duplicateCompletion.statusCode).toBe(200);
    expect(duplicateCompletion.json()).toEqual(uploaded.completion);

    const createPayload = { schemaVersion: 1, versionId: uploaded.intent.versionId };
    const first = await uploaded.app.inject({
      method: "POST",
      url: "/v1/deployments",
      headers: { ...actorHeaders, "idempotency-key": "deploy-once" },
      payload: createPayload,
    });
    const second = await uploaded.app.inject({
      method: "POST",
      url: "/v1/deployments",
      headers: { ...actorHeaders, "idempotency-key": "deploy-once" },
      payload: createPayload,
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    const deployment = deploymentCreatedV1Schema.parse(first.json());
    expect(second.json()).toEqual(first.json());
    expect(deployment.status).toBe("QUEUED");

    const statusResponse = await uploaded.app.inject({
      method: "GET",
      url: `/v1/deployments/${deployment.deploymentId}`,
      headers: actorHeaders,
    });
    const status = deploymentStatusV1Schema.parse(statusResponse.json());
    expect(status.status).toBe("QUEUED");
    expect(status.publicUrl).toBeNull();
    expect(status.events.map((event) => event.customerMessage)).toEqual([
      "Upload received",
      "Checking your project",
    ]);
    expect(status.events.some((event) => "internalMetadata" in event)).toBe(false);
  });

  it("enforces the one-active-deployment prototype quota", async () => {
    const firstUpload = await upload("First app", new TextEncoder().encode("first"));
    const first = await firstUpload.app.inject({
      method: "POST",
      url: "/v1/deployments",
      headers: { ...actorHeaders, "idempotency-key": "first" },
      payload: { schemaVersion: 1, versionId: firstUpload.intent.versionId },
    });
    expect(first.statusCode).toBe(202);

    const secondUpload = await upload("Second app", new TextEncoder().encode("second"));
    const limited = await secondUpload.app.inject({
      method: "POST",
      url: "/v1/deployments",
      headers: { ...actorHeaders, "idempotency-key": "second" },
      payload: { schemaVersion: 1, versionId: secondUpload.intent.versionId },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("15");
    expect(limited.json()).toMatchObject({
      error: { code: "DEPLOYMENT_RATE_LIMITED", retryable: true },
    });
  });

  it("rejects content that does not match the declared hash", async () => {
    const app = buildApi({
      database,
      storage,
      actorHashSecret: "test-secret-that-is-long-enough-for-hmac",
    });
    const declared = new TextEncoder().encode("declared");
    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: actorHeaders,
      payload: {
        schemaVersion: 1,
        appName: "Hash test",
        fileName: "site.zip",
        size: declared.byteLength,
        sha256: createHash("sha256").update(declared).digest("hex"),
      },
    });
    const intent = uploadIntentV1Schema.parse(response.json());
    storage.put(intent.upload.pathname, new TextEncoder().encode("tampered"));

    const completion = await app.inject({
      method: "POST",
      url: `/v1/uploads/${intent.uploadId}/complete`,
      headers: actorHeaders,
    });
    expect(completion.statusCode).toBe(400);
    expect(completion.json()).toMatchObject({ error: { code: "UPLOAD_INVALID" } });
  });

  it("replaces stored source, secret, and provider text with canonical customer copy", async () => {
    const uploaded = await upload("Failure boundary", new TextEncoder().encode("failure"));
    const created = await uploaded.app.inject({
      method: "POST",
      url: "/v1/deployments",
      headers: { ...actorHeaders, "idempotency-key": "failure-boundary" },
      payload: { schemaVersion: 1, versionId: uploaded.intent.versionId },
    });
    const deployment = deploymentCreatedV1Schema.parse(created.json());
    const internalText = "VERCEL_TOKEN=secret-value <script>raw source</script> provider log";
    await new DeploymentRepository(database).transition({
      id: deployment.deploymentId,
      to: "FAILED",
      errorCode: "PROVIDER_DEPLOYMENT_FAILED",
      errorSummary: internalText,
      errorRetryable: true,
      errorRetryAfterSeconds: 90,
    });
    await new DeploymentEventRepository(database).append({
      id: "event-sensitive-provider-failure",
      deploymentId: deployment.deploymentId,
      type: "error",
      code: "PROVIDER_DEPLOYMENT_FAILED",
      customerMessage: internalText,
      internalMetadata: { logs: [internalText] },
    });

    const response = await uploaded.app.inject({
      method: "GET",
      url: `/v1/deployments/${deployment.deploymentId}`,
      headers: actorHeaders,
    });
    const serialized = response.body;
    const status = deploymentStatusV1Schema.parse(response.json());
    expect(status.error).toMatchObject({
      code: "PROVIDER_DEPLOYMENT_FAILED",
      message: "The approved project could not be published.",
      guidance: "Try again in about 2 minutes.",
      retryable: true,
      retryAfterSeconds: 90,
    });
    expect(status.events.at(-1)?.customerMessage)
      .toBe("The approved project could not be published.");
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("raw source");
    expect(serialized).not.toContain("provider log");
    expect(serialized).not.toContain("internalMetadata");
  });

  it("authorizes, audits, and enforces operator suspension", async () => {
    const uploaded = await upload("Suspension test", new TextEncoder().encode("suspend"));
    const create = await uploaded.app.inject({
      method: "POST",
      url: "/v1/deployments",
      headers: { ...actorHeaders, "idempotency-key": "suspend-me" },
      payload: { schemaVersion: 1, versionId: uploaded.intent.versionId },
    });
    const deployment = deploymentCreatedV1Schema.parse(create.json());
    await new DeploymentRepository(database).setProviderResult({
      id: deployment.deploymentId,
      providerDeploymentId: "provider-deployment-1",
      publicUrl: "https://unsafe.example",
    });

    const remove = vi.fn(async () => undefined);
    const operatorApp = buildApi({
      database,
      storage,
      actorHashSecret: "test-secret-that-is-long-enough-for-hmac",
      operator: {
        apiKey: "operator-secret",
        deploymentProvider: { remove },
      },
    });
    const denied = await operatorApp.inject({
      method: "POST",
      url: `/v1/operator/apps/${uploaded.intent.appId}/suspend`,
      headers: {
        "x-pocketcloud-operator-key": "wrong",
        "x-pocketcloud-operator-id": "ops@example.com",
      },
      payload: { reason: "Reported harmful content" },
    });
    expect(denied.statusCode).toBe(401);

    const suspended = await operatorApp.inject({
      method: "POST",
      url: `/v1/operator/apps/${uploaded.intent.appId}/suspend`,
      headers: {
        "x-pocketcloud-operator-key": "operator-secret",
        "x-pocketcloud-operator-id": "ops@example.com",
      },
      payload: { reason: "Reported harmful content" },
    });
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json()).toMatchObject({
      appStatus: "SUSPENDED",
      affectedDeployments: 1,
    });
    expect(remove).toHaveBeenCalledWith("provider-deployment-1");
    expect(await new AppRepository(database).findById(uploaded.intent.appId)).toMatchObject({
      status: "SUSPENDED",
    });
    expect(await new DeploymentRepository(database).findById(deployment.deploymentId)).toMatchObject({
      status: "SUSPENDED",
      publicUrl: null,
    });
    expect(
      await new OperatorActionRepository(database).listForApp(uploaded.intent.appId),
    ).toEqual([
      expect.objectContaining({
        operatorActor: "ops@example.com",
        reason: "Reported harmful content",
        providerCleanupStatus: "COMPLETED",
      }),
    ]);

    const deniedOperations = await operatorApp.inject({
      method: "GET",
      url: "/v1/operator/operations",
    });
    expect(deniedOperations.statusCode).toBe(401);
    const operations = await operatorApp.inject({
      method: "GET",
      url: "/v1/operator/operations",
      headers: {
        "x-pocketcloud-operator-key": "operator-secret",
        "x-pocketcloud-operator-id": "ops@example.com",
      },
    });
    expect(operations.statusCode).toBe(200);
    expect(operations.json()).toMatchObject({
      suspendedApps: 1,
      storage: { retainedArtifacts: 1 },
      queue: { queued: 0, claimed: 0 },
    });

    const blockedUpload = await operatorApp.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: actorHeaders,
      payload: {
        schemaVersion: 1,
        appId: uploaded.intent.appId,
        appName: "Suspension test",
        fileName: "site.zip",
        size: 1,
        sha256: "a".repeat(64),
      },
    });
    expect(blockedUpload.statusCode).toBe(409);
    expect(blockedUpload.json()).toMatchObject({ error: { code: "DEPLOYMENT_SUSPENDED" } });

    const reenabled = await operatorApp.inject({
      method: "POST",
      url: `/v1/operator/apps/${uploaded.intent.appId}/reenable`,
      headers: {
        "x-pocketcloud-operator-key": "operator-secret",
        "x-pocketcloud-operator-id": "ops@example.com",
      },
      payload: { reason: "Manual review completed" },
    });
    expect(reenabled.statusCode).toBe(200);
    expect(reenabled.json()).toMatchObject({ appStatus: "ACTIVE" });
  });
});
