import { createHash } from "node:crypto";

import type { ArtifactFile, DeployableArtifact } from "@pocketcloud/core";
import { describe, expect, it } from "vitest";

import { VercelDeploymentProvider } from "./vercel-deployment-provider";

const runLiveIntegration = process.env.POCKETCLOUD_RUN_VERCEL_DEPLOYMENT_INTEGRATION === "1";

function tinyArtifact(): DeployableArtifact {
  const bytes = new TextEncoder().encode("<!doctype html><title>PocketCloud integration fixture</title>");
  const file: ArtifactFile = {
    path: "index.html",
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType: "text/html",
  };
  return {
    manifest: {
      schemaVersion: 1,
      artifactId: `pc-206-integration-${Date.now()}`,
      kind: "normalized",
      sha256: "a".repeat(64),
      totalBytes: bytes.byteLength,
      fileCount: 1,
      files: [file],
      createdAt: new Date().toISOString(),
    },
    files: { async *read() { yield bytes; } },
    idempotencyKey: `pc-206-integration-${Date.now()}`,
  };
}

describe.skipIf(!runLiveIntegration)("VercelDeploymentProvider live integration", () => {
  it("deploys, observes, reads logs, and removes a tiny static fixture", async () => {
    const token = process.env.VERCEL_TOKEN;
    if (!token) throw new Error("VERCEL_TOKEN is required for the opt-in integration test");
    const provider = new VercelDeploymentProvider({
      token,
      projectName: process.env.VERCEL_PROJECT_NAME ?? "pocketcloud-integration",
      ...(process.env.VERCEL_PROJECT_ID ? { projectId: process.env.VERCEL_PROJECT_ID } : {}),
      ...(process.env.VERCEL_TEAM_ID ? { teamId: process.env.VERCEL_TEAM_ID } : {}),
    });
    const deployment = await provider.deploy(tinyArtifact());
    try {
      expect(deployment.provider).toBe("vercel");
      expect(deployment.candidateUrl).toMatch(/^https:\/\//);
      let status = await provider.getStatus(deployment.providerDeploymentId);
      const deadline = Date.now() + 60_000;
      while ((status === "PENDING" || status === "BUILDING") && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        status = await provider.getStatus(deployment.providerDeploymentId);
      }
      expect(["READY", "FAILED"]).toContain(status);
      await expect(provider.getLogs(deployment.providerDeploymentId)).resolves.toEqual(expect.any(Array));
    } finally {
      await provider.remove(deployment.providerDeploymentId);
      await provider.remove(deployment.providerDeploymentId);
    }
  }, 90_000);
});
