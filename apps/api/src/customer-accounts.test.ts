import { createHash } from "node:crypto";

import {
  customerDashboardV1Schema,
  uploadIntentV1Schema,
} from "@pocketcloud/core";
import {
  AppRepository,
  ArtifactRepository,
  DeploymentRepository,
  DeploymentWorkerCheckpointRepository,
  MemoryPrivateObjectStorage,
  VersionRepository,
} from "@pocketcloud/platform";
import {
  createMigratedTestDatabase,
  type PGliteTestDatabase,
} from "@pocketcloud/platform/testing";
import type { FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AuthenticatedCustomer,
  CustomerIdentityProvider,
} from "./auth/customer";
import { buildApi } from "./build-app";

class HeaderIdentityProvider implements CustomerIdentityProvider {
  async authenticate(request: FastifyRequest): Promise<AuthenticatedCustomer | null> {
    const externalUserId = request.headers["x-test-user"];
    if (typeof externalUserId !== "string") return null;
    return {
      externalUserId,
      primaryEmail: `${externalUserId}@example.com`,
      displayName: externalUserId === "customer-one" ? "Ada Owner" : "Grace Owner",
    };
  }
}

describe("customer accounts and workspace isolation", () => {
  let database: PGliteTestDatabase;
  let app: ReturnType<typeof buildApi>;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    app = buildApi({
      database,
      storage: new MemoryPrivateObjectStorage(),
      actorHashSecret: "test-secret-that-is-long-enough-for-hmac",
      customerIdentity: new HeaderIdentityProvider(),
    });
  });

  afterEach(async () => {
    await app.close();
    await database.close();
  });

  async function dashboard(user: string) {
    const response = await app.inject({
      method: "GET",
      url: "/v1/customer/dashboard",
      headers: { "x-test-user": user },
    });
    expect(response.statusCode).toBe(200);
    return customerDashboardV1Schema.parse(response.json());
  }

  async function createUploadIntent(user: string, appName: string) {
    const bytes = new TextEncoder().encode(`${user}-${appName}`);
    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { "x-test-user": user },
      payload: {
        schemaVersion: 1,
        appName,
        fileName: "site.zip",
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });
    expect(response.statusCode).toBe(201);
    return uploadIntentV1Schema.parse(response.json());
  }

  it("requires a signed-in customer", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/customer/dashboard" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("provisions one stable personal workspace for a real account", async () => {
    const first = await dashboard("customer-one");
    const second = await dashboard("customer-one");

    expect(first.session.user).toMatchObject({
      primaryEmail: "customer-one@example.com",
      displayName: "Ada Owner",
    });
    expect(first.session.workspace).toMatchObject({ role: "OWNER", planCode: "FREE" });
    expect(second.session.workspace.workspaceId).toBe(first.session.workspace.workspaceId);

    const counts = await database.query<{ users: number; workspaces: number; memberships: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM users) AS users,
         (SELECT COUNT(*)::int FROM workspaces) AS workspaces,
         (SELECT COUNT(*)::int FROM workspace_memberships) AS memberships`,
    );
    expect(counts.rows[0]).toEqual({ users: 1, workspaces: 1, memberships: 1 });
  });

  it("attaches new apps and deployment history only to the owner's workspace", async () => {
    const firstIntent = await createUploadIntent("customer-one", "Ada launch");
    await createUploadIntent("customer-two", "Grace launch");

    const first = await dashboard("customer-one");
    const second = await dashboard("customer-two");
    expect(first.apps.map((item) => item.name)).toEqual(["Ada launch"]);
    expect(second.apps.map((item) => item.name)).toEqual(["Grace launch"]);
    expect(first.session.workspace.workspaceId).not.toBe(second.session.workspace.workspaceId);

    const deployment = await new DeploymentRepository(database).create({
      id: "dep_customer_one",
      actorKey: `workspace:${first.session.workspace.workspaceId}`,
      appId: firstIntent.appId,
      versionId: firstIntent.versionId,
      idempotencyKey: "customer-one-deployment",
      initialState: "QUEUED",
    });
    const firstWithHistory = await dashboard("customer-one");
    const secondWithoutHistory = await dashboard("customer-two");
    expect(firstWithHistory.deployments).toMatchObject([
      { deploymentId: deployment.id, appName: "Ada launch", status: "QUEUED" },
    ]);
    expect(secondWithoutHistory.deployments).toEqual([]);

    const crossAccount = await app.inject({
      method: "GET",
      url: `/v1/deployments/${deployment.id}`,
      headers: { "x-test-user": "customer-two" },
    });
    expect(crossAccount.statusCode).toBe(404);
  });

  it("audits idempotent lifecycle actions and republishes only the approved artifact", async () => {
    const remove = vi.fn(async () => undefined);
    const enqueue = vi.fn(async () => undefined);
    await app.close();
    app = buildApi({
      database,
      storage: new MemoryPrivateObjectStorage(),
      actorHashSecret: "test-secret-that-is-long-enough-for-hmac",
      customerIdentity: new HeaderIdentityProvider(),
      customerLifecycle: { deploymentProvider: { remove } },
      deploymentDispatcher: { enqueue },
    });

    const intent = await createUploadIntent("customer-one", "Lifecycle site");
    const normalizedArtifactId = "art_lifecycle_normalized";
    await new ArtifactRepository(database).insert({
      id: normalizedArtifactId,
      kind: "normalized",
      storageProvider: "memory",
      storageKey: "artifacts/lifecycle-normalized",
      sha256: "a".repeat(64),
      compressedBytes: 100,
      expandedBytes: 100,
      fileCount: 1,
      status: "APPROVED",
    });
    const plan = {
      schemaVersion: 1 as const,
      kind: "static" as const,
      projectRoot: "." as const,
      entrypoint: "index.html",
      runtime: null,
      framework: null,
      installCommand: null,
      buildCommand: null,
      startCommand: null,
      outputDirectory: "." as const,
      requiredEnvironmentVariables: [],
      deploymentProvider: "vercel",
      evidence: [],
    };
    await new VersionRepository(database).recordWorkerOutput({
      versionId: intent.versionId,
      normalizedArtifactId,
      projectPlan: plan,
      platformCheckStatus: "DEPLOYED",
    });
    await new AppRepository(database).promoteVersion(intent.appId, intent.versionId);

    const redeployRequest = {
      method: "POST" as const,
      url: `/v1/customer/apps/${intent.appId}/redeploy`,
      headers: { "x-test-user": "customer-one", "idempotency-key": "redeploy-once" },
    };
    const [first, second] = await Promise.all([
      app.inject(redeployRequest),
      app.inject(redeployRequest),
    ]);
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(first.json()).toEqual(second.json());
    const action = first.json() as { actionId: string; deploymentId: string };
    const checkpoint = await new DeploymentWorkerCheckpointRepository(database).load(
      action.deploymentId,
    );
    expect(checkpoint).toMatchObject({
      lastState: "READY_TO_DEPLOY",
      normalizedArtifactId,
      projectPlan: plan,
    });
    const counts = await database.query<{ actions: number; deployments: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM customer_app_actions WHERE id = $1) AS actions,
         (SELECT COUNT(*)::int FROM deployments WHERE idempotency_key = $2) AS deployments`,
      [action.actionId, `customer-action:${action.actionId}`],
    );
    expect(counts.rows[0]).toEqual({ actions: 1, deployments: 1 });
    expect(enqueue).toHaveBeenCalledWith(action.deploymentId);

    const crossWorkspace = await app.inject({
      method: "POST",
      url: `/v1/customer/apps/${intent.appId}/suspend`,
      headers: { "x-test-user": "customer-two", "idempotency-key": "not-owner" },
    });
    expect(crossWorkspace.statusCode).toBe(404);
  });

  it("suspends, soft-deletes, restores, and protects operator-blocked apps", async () => {
    const remove = vi.fn(async () => undefined);
    const enqueue = vi.fn(async () => undefined);
    await app.close();
    app = buildApi({
      database,
      storage: new MemoryPrivateObjectStorage(),
      actorHashSecret: "test-secret-that-is-long-enough-for-hmac",
      customerIdentity: new HeaderIdentityProvider(),
      customerLifecycle: { deploymentProvider: { remove } },
      deploymentDispatcher: { enqueue },
    });

    const intent = await createUploadIntent("customer-one", "Recovery site");
    const workspace = (await dashboard("customer-one")).session.workspace;
    const normalizedArtifactId = "art_recovery_normalized";
    await new ArtifactRepository(database).insert({
      id: normalizedArtifactId,
      kind: "normalized",
      storageProvider: "memory",
      storageKey: "artifacts/recovery-normalized",
      sha256: "b".repeat(64),
      compressedBytes: 100,
      expandedBytes: 100,
      fileCount: 1,
      status: "APPROVED",
    });
    await new VersionRepository(database).recordWorkerOutput({
      versionId: intent.versionId,
      normalizedArtifactId,
      projectPlan: {
        schemaVersion: 1,
        kind: "static",
        projectRoot: ".",
        entrypoint: "index.html",
        runtime: null,
        framework: null,
        installCommand: null,
        buildCommand: null,
        startCommand: null,
        outputDirectory: ".",
        requiredEnvironmentVariables: [],
        deploymentProvider: "vercel",
        evidence: [],
      },
      platformCheckStatus: "DEPLOYED",
    });
    await new AppRepository(database).promoteVersion(intent.appId, intent.versionId);
    await new DeploymentRepository(database).create({
      id: "dep_public_recovery",
      actorKey: `workspace:${workspace.workspaceId}`,
      appId: intent.appId,
      versionId: intent.versionId,
      idempotencyKey: "public-recovery",
      initialState: "READY",
    });
    await new DeploymentRepository(database).setProviderResult({
      id: "dep_public_recovery",
      providerDeploymentId: "dpl_public_recovery",
      publicUrl: "https://recovery.example",
    });

    const suspend = await app.inject({
      method: "POST",
      url: `/v1/customer/apps/${intent.appId}/suspend`,
      headers: { "x-test-user": "customer-one", "idempotency-key": "suspend-recovery" },
    });
    expect(suspend.statusCode).toBe(200);
    expect(remove).toHaveBeenCalledWith("dpl_public_recovery");
    expect(await new AppRepository(database).findById(intent.appId)).toMatchObject({
      status: "SUSPENDED",
      suspensionSource: "CUSTOMER",
    });

    const restore = await app.inject({
      method: "POST",
      url: `/v1/customer/apps/${intent.appId}/restore`,
      headers: { "x-test-user": "customer-one", "idempotency-key": "restore-recovery" },
    });
    expect(restore.statusCode).toBe(202);
    expect(await new AppRepository(database).findById(intent.appId)).toMatchObject({
      status: "ACTIVE",
      suspensionSource: null,
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/customer/apps/${intent.appId}`,
      headers: { "x-test-user": "customer-one", "idempotency-key": "delete-recovery" },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ appStatus: "DELETED", recoverableUntil: expect.any(String) });
    expect((await dashboard("customer-one")).apps[0]).toMatchObject({
      status: "DELETED",
      availableActions: { restore: true },
    });

    await new AppRepository(database).setStatus(intent.appId, "SUSPENDED", "OPERATOR");
    const blocked = await app.inject({
      method: "POST",
      url: `/v1/customer/apps/${intent.appId}/restore`,
      headers: { "x-test-user": "customer-one", "idempotency-key": "operator-blocked" },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: "DEPLOYMENT_SUSPENDED" } });
  });
});
