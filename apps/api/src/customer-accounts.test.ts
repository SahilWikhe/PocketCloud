import { createHash } from "node:crypto";

import {
  customerDashboardV1Schema,
  uploadIntentV1Schema,
} from "@pocketcloud/core";
import {
  DeploymentRepository,
  MemoryPrivateObjectStorage,
} from "@pocketcloud/platform";
import {
  createMigratedTestDatabase,
  type PGliteTestDatabase,
} from "@pocketcloud/platform/testing";
import type { FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
});
