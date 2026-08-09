import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppRepository } from "../database/apps";
import { ArtifactFileRepository, ArtifactRepository } from "../database/artifacts";
import { DeploymentRepository } from "../database/deployments";
import { DeploymentJobRepository } from "../database/jobs";
import { VersionRepository } from "../database/versions";
import { createMigratedTestDatabase, type PGliteTestDatabase } from "../testing/pglite";
import { PostgresDeploymentQueue } from "./postgres-deployment-queue";

describe("PostgresDeploymentQueue", () => {
  let database: PGliteTestDatabase;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
  });

  afterEach(async () => {
    await database.close();
  });

  it("hands Builder B a validated shared DeploymentJob payload", async () => {
    await database.transaction(async (transaction) => {
      await new AppRepository(transaction).create({
        id: "app-1",
        actorKey: "actor-1",
        name: "Demo",
        slug: "demo",
      });
      await new VersionRepository(transaction).createPending({ id: "version-1", appId: "app-1" });
      await new ArtifactRepository(transaction).insert({
        id: "artifact-1",
        kind: "original",
        storageProvider: "memory",
        storageKey: "quarantine/artifact-1/upload.zip",
        sha256: "a".repeat(64),
        compressedBytes: 10,
        status: "QUARANTINED",
      });
      await new ArtifactFileRepository(transaction).insert({
        artifactId: "artifact-1",
        path: "upload.zip",
        sha256: "a".repeat(64),
        size: 10,
        mediaType: "application/zip",
        storageKey: "quarantine/artifact-1/upload.zip",
      });
      await new VersionRepository(transaction).sealOriginalArtifact({
        versionId: "version-1",
        artifactId: "artifact-1",
      });
      await new DeploymentRepository(transaction).create({
        id: "deployment-1",
        actorKey: "actor-1",
        appId: "app-1",
        versionId: "version-1",
        idempotencyKey: "request-1",
        initialState: "QUEUED",
      });
      await new DeploymentJobRepository(transaction).enqueue({
        id: "job-1",
        deploymentId: "deployment-1",
      });
    });

    const claim = await new PostgresDeploymentQueue(database, 3).claim("worker-a", 30);
    expect(claim).toMatchObject({
      workerId: "worker-a",
      job: {
        schemaVersion: 1,
        jobId: "job-1",
        deploymentId: "deployment-1",
        appId: "app-1",
        versionId: "version-1",
        originalArtifactId: "artifact-1",
        attempt: 1,
        maxAttempts: 3,
      },
    });
  });
});
