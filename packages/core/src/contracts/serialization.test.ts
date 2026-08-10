import { describe, expect, it } from "vitest";

import { artifactManifestV1Schema } from "./artifact";
import { deploymentEventV1Schema } from "./events";
import { deploymentDispatchV1Schema, deploymentJobV1Schema } from "./job";
import { normalizationChangeV1Schema } from "./normalization";
import { projectPlanV1Schema } from "./project-plan";
import { usageReportV1Schema } from "./usage";

const timestamp = "2026-08-09T20:00:00.000Z";
const hash = "a".repeat(64);

describe("shared contract serialization", () => {
  it.each([
    [deploymentDispatchV1Schema, {
      schemaVersion: 1,
      deploymentId: "deployment-1",
    }],
    [deploymentJobV1Schema, {
      schemaVersion: 1,
      jobId: "job-1",
      deploymentId: "deployment-1",
      appId: "app-1",
      versionId: "version-1",
      originalArtifactId: "artifact-1",
      correlationId: "correlation-1",
      attempt: 1,
      maxAttempts: 3,
      requestedAt: timestamp,
    }],
    [projectPlanV1Schema, {
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
      evidence: [{ code: "ENTRYPOINT", path: "index.html", summary: "Static entry point" }],
    }],
    [artifactManifestV1Schema, {
      schemaVersion: 1,
      artifactId: "artifact-1",
      kind: "normalized",
      sha256: hash,
      totalBytes: 10,
      fileCount: 1,
      files: [{ path: "index.html", sha256: hash, size: 10, mediaType: "text/html" }],
      createdAt: timestamp,
    }],
    [normalizationChangeV1Schema, {
      schemaVersion: 1,
      changeId: "change-1",
      source: "deterministic",
      ruleCode: "MOVE_WRAPPER",
      operation: "move",
      path: "index.html",
      previousPath: "site/index.html",
      beforeSha256: hash,
      afterSha256: hash,
      summary: "Moved the site to the deployable root.",
      requiresCustomerAttention: false,
    }],
    [deploymentEventV1Schema, {
      schemaVersion: 1,
      deploymentId: "deployment-1",
      type: "progress",
      code: "CHECKING_PROJECT",
      customerMessage: "Checking your project",
      occurredAt: timestamp,
    }],
    [usageReportV1Schema, {
      schemaVersion: 1,
      deploymentId: "deployment-1",
      metric: "upload_bytes",
      quantity: 10,
      occurredAt: timestamp,
    }],
  ])("round-trips schema %s", (schema, value) => {
    expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });
});
