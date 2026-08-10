import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppRepository } from "./apps";
import { ArtifactRepository } from "./artifacts";
import type { SqlExecutor } from "./client";
import { DeploymentRepository } from "./deployments";
import { DeploymentEventRepository } from "./events";
import { DeploymentJobRepository } from "./jobs";
import { NormalizationChangeRepository } from "./changes";
import { VersionRepository } from "./versions";
import { createMigratedTestDatabase, type PGliteTestDatabase } from "../testing/pglite";

const hash = "a".repeat(64);

describe("PostgreSQL repositories", () => {
  let database: PGliteTestDatabase;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
  });

  afterEach(async () => {
    await database.close();
  });

  async function createVersion(executor: SqlExecutor = database) {
    const apps = new AppRepository(executor);
    const versions = new VersionRepository(executor);
    await apps.create({ id: "app-1", actorKey: "actor-1", name: "Demo", slug: "demo" });
    return versions.createPending({ id: "version-1", appId: "app-1" });
  }

  it("keeps original artifact rows immutable", async () => {
    const artifacts = new ArtifactRepository(database);
    await artifacts.insert({
      id: "artifact-1",
      kind: "original",
      storageProvider: "vercel_blob",
      storageKey: "quarantine/artifact-1/site.zip",
      sha256: hash,
      compressedBytes: 100,
      status: "QUARANTINED",
    });

    await expect(
      artifacts.insert({
        id: "artifact-1",
        kind: "original",
        storageProvider: "vercel_blob",
        storageKey: "quarantine/artifact-1/replacement.zip",
        sha256: "b".repeat(64),
        compressedBytes: 200,
        status: "QUARANTINED",
      }),
    ).rejects.toThrow();

    expect(await artifacts.findById("artifact-1")).toMatchObject({
      storageKey: "quarantine/artifact-1/site.zip",
      sha256: hash,
      compressedBytes: 100,
    });
  });

  it("enforces idempotency and ordered deployment events", async () => {
    await database.transaction(async (transaction) => {
      await createVersion(transaction);
      const artifacts = new ArtifactRepository(transaction);
      const versions = new VersionRepository(transaction);
      await artifacts.insert({
        id: "artifact-1",
        kind: "original",
        storageProvider: "vercel_blob",
        storageKey: "quarantine/artifact-1/site.zip",
        sha256: hash,
        compressedBytes: 100,
        status: "QUARANTINED",
      });
      await versions.sealOriginalArtifact({ versionId: "version-1", artifactId: "artifact-1" });
    });

    const deployments = new DeploymentRepository(database);
    await deployments.create({
      id: "deployment-1",
      actorKey: "actor-1",
      appId: "app-1",
      versionId: "version-1",
      idempotencyKey: "same-request",
    });
    await expect(
      deployments.create({
        id: "deployment-2",
        actorKey: "actor-1",
        appId: "app-1",
        versionId: "version-1",
        idempotencyKey: "same-request",
      }),
    ).rejects.toThrow();

    const events = new DeploymentEventRepository(database);
    await Promise.all(
      ["UPLOAD_RECEIVED", "QUEUED", "CHECKING_PROJECT"].map((code, index) =>
        events.append({
          id: `event-${index}`,
          deploymentId: "deployment-1",
          type: "progress",
          code,
          customerMessage: code,
        }),
      ),
    );
    const persisted = await events.listCustomerVisible("deployment-1");
    expect(persisted.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(persisted.every((event) => event.internalMetadata === undefined)).toBe(true);

    await new AppRepository(database).create({
      id: "app-2",
      actorKey: "actor-2",
      name: "Second demo",
      slug: "second-demo",
    });
    await new VersionRepository(database).createPending({ id: "version-2", appId: "app-2" });
    const identicalChange = {
      schemaVersion: 1 as const,
      changeId: "change-same-content",
      source: "deterministic" as const,
      ruleCode: "MOVE_WRAPPER",
      operation: "move" as const,
      path: "index.html",
      previousPath: "site/index.html",
      summary: "Moved the static site into the deployment root.",
      requiresCustomerAttention: false,
    };
    const changes = new NormalizationChangeRepository(database);
    await changes.record("version-1", identicalChange);
    await changes.record("version-2", identicalChange);
    expect(await changes.listForVersion("version-1")).toEqual([identicalChange]);
    expect(await changes.listForVersion("version-2")).toEqual([identicalChange]);
  });

  it("allows only one worker to claim a queued job", async () => {
    await createVersion();
    const deployments = new DeploymentRepository(database);
    await deployments.create({
      id: "deployment-1",
      actorKey: "actor-1",
      appId: "app-1",
      versionId: "version-1",
      idempotencyKey: "request-1",
      initialState: "QUEUED",
    });
    const jobs = new DeploymentJobRepository(database);
    await jobs.enqueue({ id: "job-1", deploymentId: "deployment-1" });

    const claims = await Promise.all([
      jobs.claimNext({ workerId: "worker-a", leaseSeconds: 30 }),
      jobs.claimNext({ workerId: "worker-b", leaseSeconds: 30 }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({ id: "job-1", attempt: 1, status: "CLAIMED" });
  });
});
