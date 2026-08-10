import { createHash } from "node:crypto";

import { PocketCloudError, type ArtifactFile, type DeployableArtifact } from "@pocketcloud/core";
import { describe, expect, it, vi } from "vitest";

import { VercelDeploymentProvider } from "./vercel-deployment-provider";

const timestamp = "2026-08-09T20:00:00.000Z";

function artifact(kind: "normalized" | "original" = "normalized", content = "<!doctype html><title>Tiny</title>"): DeployableArtifact {
  const bytes = new TextEncoder().encode(content);
  const file: ArtifactFile = {
    path: "index.html",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
    mediaType: "text/html",
  };
  return {
    manifest: {
      schemaVersion: 1,
      artifactId: "artifact-206",
      kind,
      sha256: "a".repeat(64),
      totalBytes: bytes.byteLength,
      fileCount: 1,
      files: [file],
      createdAt: timestamp,
    },
    files: {
      async *read(requestedFile) {
        expect(requestedFile).toEqual(file);
        yield bytes.subarray(0, 5);
        yield bytes.subarray(5);
      },
    },
    idempotencyKey: "deployment-206",
  };
}

function fakeSdk() {
  return {
    uploadFile: vi.fn(async (_request: { requestBody: Uint8Array }, _options?: unknown) => ({})),
    createDeployment: vi.fn(async () => ({ id: "dpl_206", url: "tiny.vercel.app", projectId: "prj_206" })),
    getDeployment: vi.fn(async () => ({ readyState: "READY" })),
    getDeploymentEvents: vi.fn(async (): Promise<unknown> => []),
    cancelDeployment: vi.fn(async () => ({})),
    deleteDeployment: vi.fn(async () => ({ uid: "dpl_206", state: "DELETED" })),
  };
}

function provider(sdk = fakeSdk()) {
  return {
    sdk,
    provider: new VercelDeploymentProvider({
      token: "test-token-not-a-secret",
      teamId: "team_206",
      projectId: "prj_206",
      projectName: "pocketcloud-apps",
      sdk,
      now: () => Date.parse(timestamp),
    }),
  };
}

function sdkError(statusCode: number, headers: Headers = new Headers()): Error & { statusCode: number; headers: Headers } {
  return Object.assign(new Error("provider details token=secret-value"), { statusCode, headers });
}

describe("VercelDeploymentProvider", () => {
  it("verifies and uploads manifest files before creating an isolated preview deployment", async () => {
    const { sdk, provider: adapter } = provider();
    await expect(adapter.deploy(artifact())).resolves.toEqual({
      provider: "vercel",
      providerDeploymentId: "dpl_206",
      providerProjectId: "prj_206",
      candidateUrl: "https://tiny.vercel.app",
    });
    const bytes = new TextEncoder().encode("<!doctype html><title>Tiny</title>");
    expect(sdk.uploadFile).toHaveBeenCalledWith({
      teamId: "team_206",
      contentLength: bytes.byteLength,
      xVercelDigest: createHash("sha1").update(bytes).digest("hex"),
      requestBody: bytes,
    }, { timeoutMs: 30_000 });
    expect(sdk.createDeployment).toHaveBeenCalledWith({
      teamId: "team_206",
      skipAutoDetectionConfirmation: "1",
      requestBody: {
        name: "pocketcloud-apps",
        project: "prj_206",
        files: [
          { file: "index.html", sha: createHash("sha1").update(bytes).digest("hex"), size: bytes.byteLength },
          { file: "vercel.json", sha: expect.stringMatching(/^[a-f0-9]{40}$/), size: expect.any(Number) },
        ],
        meta: { pocketcloudArtifactId: "artifact-206", pocketcloudIdempotencyKey: "deployment-206" },
        projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null, rootDirectory: null },
      },
    }, { timeoutMs: 30_000, headers: { "x-vercel-idempotency-key": "deployment-206" } });
    expect(sdk.uploadFile).toHaveBeenCalledTimes(2);
    const configurationUpload = sdk.uploadFile.mock.calls[1]![0];
    const configuration = JSON.parse(new TextDecoder().decode(configurationUpload.requestBody)) as { headers: { headers: { key: string }[] }[] };
    expect(configuration.headers[0]?.headers.map((header) => header.key)).toEqual(expect.arrayContaining([
      "X-Content-Type-Options",
      "Content-Security-Policy",
      "Permissions-Policy",
    ]));
  });

  it("accepts only approved, complete artifacts and makes no provider call after rejection", async () => {
    const { sdk, provider: adapter } = provider();
    await expect(adapter.deploy(artifact("original"))).rejects.toMatchObject({ code: "ARTIFACT_INCOMPLETE", retryable: false });
    const incomplete = artifact();
    incomplete.manifest.files[0]!.sha256 = "0".repeat(64);
    await expect(adapter.deploy(incomplete)).rejects.toMatchObject({ code: "ARTIFACT_INCOMPLETE", retryable: false });
    expect(sdk.uploadFile).not.toHaveBeenCalled();
    expect(sdk.createDeployment).not.toHaveBeenCalled();
  });

  it.each([
    ["QUEUED", "PENDING"],
    ["INITIALIZING", "PENDING"],
    ["BUILDING", "BUILDING"],
    ["READY", "READY"],
    ["ERROR", "FAILED"],
    ["BLOCKED", "FAILED"],
    ["CANCELED", "CANCELLED"],
  ])("maps Vercel state %s to %s", async (readyState, expected) => {
    const sdk = fakeSdk();
    sdk.getDeployment.mockResolvedValueOnce({ readyState });
    await expect(provider(sdk).provider.getStatus("dpl_206")).resolves.toBe(expected);
  });

  it("maps bounded internal events and redacts common credential forms", async () => {
    const sdk = fakeSdk();
    sdk.getDeploymentEvents.mockResolvedValueOnce([
      { type: "stdout", date: Date.parse(timestamp), text: "building" },
      { type: "stderr", created: Date.parse(timestamp), text: "TOKEN=secret-value failed" },
      { type: "stdout", created: Date.parse(timestamp), text: "" },
    ]);
    await expect(provider(sdk).provider.getLogs("dpl_206")).resolves.toEqual([
      { occurredAt: timestamp, level: "info", message: "building" },
      { occurredAt: timestamp, level: "error", message: "TOKEN=[redacted] failed" },
    ]);
  });

  it("maps rate limits and provider failures to stable customer-safe errors", async () => {
    const sdk = fakeSdk();
    sdk.createDeployment.mockRejectedValueOnce(sdkError(429, new Headers({ "retry-after": "12" })));
    await expect(provider(sdk).provider.deploy(artifact())).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(PocketCloudError);
      expect(error).toMatchObject({ code: "PROVIDER_RATE_LIMITED", retryable: true, retryAfterSeconds: 12 });
      expect((error as Error).message).not.toContain("secret-value");
      expect(error).not.toHaveProperty("cause");
      return true;
    });

    const failingSdk = fakeSdk();
    failingSdk.getDeployment.mockRejectedValueOnce(sdkError(403));
    await expect(provider(failingSdk).provider.getStatus("dpl_206"))
      .rejects.toMatchObject({ code: "PROVIDER_DEPLOYMENT_FAILED", retryable: false });
  });

  it("makes cancellation terminal-safe and tolerates a provider terminal-state race", async () => {
    const readySdk = fakeSdk();
    await provider(readySdk).provider.cancel("dpl_206");
    expect(readySdk.cancelDeployment).not.toHaveBeenCalled();

    const buildingSdk = fakeSdk();
    buildingSdk.getDeployment.mockResolvedValueOnce({ readyState: "BUILDING" });
    buildingSdk.cancelDeployment.mockRejectedValueOnce(sdkError(400));
    await expect(provider(buildingSdk).provider.cancel("dpl_206")).resolves.toBeUndefined();
    expect(buildingSdk.cancelDeployment).toHaveBeenCalledTimes(1);

    const missingSdk = fakeSdk();
    missingSdk.getDeployment.mockRejectedValueOnce(sdkError(404));
    await expect(provider(missingSdk).provider.cancel("dpl_missing")).resolves.toBeUndefined();
    expect(missingSdk.cancelDeployment).not.toHaveBeenCalled();
  });

  it("makes concurrent and repeated removal idempotent, including not-found deployments", async () => {
    const sdk = fakeSdk();
    let release: (() => void) | undefined;
    sdk.deleteDeployment.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ uid: "dpl_206", state: "DELETED" });
    }));
    const adapter = provider(sdk).provider;
    const first = adapter.remove("dpl_206");
    const second = adapter.remove("dpl_206");
    expect(sdk.deleteDeployment).toHaveBeenCalledTimes(1);
    release?.();
    await Promise.all([first, second]);
    await adapter.remove("dpl_206");
    expect(sdk.deleteDeployment).toHaveBeenCalledTimes(1);

    const missingSdk = fakeSdk();
    missingSdk.deleteDeployment.mockRejectedValueOnce(sdkError(404));
    const missingAdapter = provider(missingSdk).provider;
    await expect(missingAdapter.remove("dpl_missing")).resolves.toBeUndefined();
    await expect(missingAdapter.remove("dpl_missing")).resolves.toBeUndefined();
    expect(missingSdk.deleteDeployment).toHaveBeenCalledTimes(1);
  });
});
