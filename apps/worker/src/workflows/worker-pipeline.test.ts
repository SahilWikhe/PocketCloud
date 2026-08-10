import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PocketCloudError,
  type ArtifactFileChunk,
  type ArtifactManifestV1,
  type ArtifactStore,
  type DeploymentEventV1,
  type DeploymentJobV1,
  type DeploymentProvider,
  type ExecutionProvider,
  type NewArtifactInput,
  type UsageReportV1,
} from "@pocketcloud/core";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { CleanupCoordinator } from "./cleanup";
import { DefaultStaticProjectProcessor } from "./static-project";
import {
  InMemoryWorkerCheckpointStore,
  WorkerPipeline,
  type WorkerStateTransition,
} from "./worker-pipeline";

// @ts-expect-error PC-200 intentionally provides a dependency-free ESM ZIP fixture builder.
import { createZip } from "../../../../tests/sample-apps/archive-fixtures.mjs";

const fixtureRoot = fileURLToPath(new URL("../../../../tests/sample-apps/projects/valid-root-static/", import.meta.url));
const timestamp = Date.parse("2026-08-09T20:00:00.000Z");
let validFixtureArchive: Uint8Array;

beforeAll(async () => {
  const entries: { name: string; bytes: Uint8Array }[] = [];
  async function collect(directory: string, prefix = ""): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await collect(path.join(directory, entry.name), relativePath);
      else if (entry.isFile()) entries.push({ name: relativePath, bytes: await readFile(path.join(directory, entry.name)) });
    }
  }
  await collect(fixtureRoot);
  validFixtureArchive = createZip(entries) as Uint8Array;
});

const job: DeploymentJobV1 = {
  schemaVersion: 1,
  jobId: "job-208",
  deploymentId: "deployment-208",
  appId: "app-208",
  versionId: "version-208",
  originalArtifactId: "artifact-original",
  correlationId: "correlation-208",
  attempt: 1,
  maxAttempts: 3,
  requestedAt: "2026-08-09T20:00:00.000Z",
};

class MemoryArtifactStore implements ArtifactStore {
  readonly manifests = new Map<string, ArtifactManifestV1>();
  readonly chunks = new Map<string, readonly ArtifactFileChunk[]>();
  writeCount = 0;
  readOriginalCount = 0;

  constructor(archive: Uint8Array) {
    const file = {
      path: "source.zip",
      sha256: createHash("sha256").update(archive).digest("hex"),
      size: archive.byteLength,
      mediaType: "application/zip",
    };
    this.manifests.set("artifact-original", {
      schemaVersion: 1,
      artifactId: "artifact-original",
      kind: "original",
      sha256: "a".repeat(64),
      totalBytes: archive.byteLength,
      fileCount: 1,
      files: [file],
      createdAt: "2026-08-09T20:00:00.000Z",
    });
    this.chunks.set("artifact-original", [{ file, offset: 0, bytes: archive }]);
  }

  async getManifest(artifactId: string): Promise<ArtifactManifestV1> {
    const manifest = this.manifests.get(artifactId);
    if (!manifest) throw new Error("missing manifest");
    return manifest;
  }

  async *readFiles(artifactId: string): AsyncIterable<ArtifactFileChunk> {
    if (artifactId === "artifact-original") this.readOriginalCount += 1;
    for (const chunk of this.chunks.get(artifactId) ?? []) yield chunk;
  }

  async writeArtifact(input: NewArtifactInput): Promise<ArtifactManifestV1> {
    this.writeCount += 1;
    const artifactId = `artifact-normalized-${this.writeCount}`;
    const chunks: ArtifactFileChunk[] = [];
    for await (const chunk of input.files) chunks.push({ ...chunk, bytes: Uint8Array.from(chunk.bytes) });
    const files = chunks.map((chunk) => chunk.file).sort((left, right) => left.path.localeCompare(right.path));
    const manifest: ArtifactManifestV1 = {
      schemaVersion: 1,
      artifactId,
      kind: input.kind,
      sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
      totalBytes: files.reduce((total, file) => total + file.size, 0),
      fileCount: files.length,
      files,
      createdAt: "2026-08-09T20:00:00.000Z",
    };
    this.manifests.set(artifactId, manifest);
    this.chunks.set(artifactId, chunks);
    return manifest;
  }
}

function setup(options: {
  archive?: Uint8Array;
  statuses?: readonly ("PENDING" | "BUILDING" | "READY" | "FAILED" | "CANCELLED" | Error)[];
  cancellation?: () => Promise<boolean>;
  verify?: () => Promise<{ publicUrl: string; status: number; contentType: string }>;
  stop?: () => Promise<void>;
  now?: () => number;
  workflowTimeoutMilliseconds?: number;
} = {}) {
  const artifacts = new MemoryArtifactStore(options.archive ?? validFixtureArchive);
  const events: DeploymentEventV1[] = [];
  const transitions: WorkerStateTransition[] = [];
  const usage: UsageReportV1[] = [];
  const writeFiles = vi.fn(async () => undefined);
  const stop = vi.fn(options.stop ?? (async () => undefined));
  const executionProvider = {
    create: vi.fn(async () => ({ environmentId: "sandbox-208", createdAt: "2026-08-09T20:00:00.000Z" })),
    writeFiles,
    stop,
  } as unknown as ExecutionProvider;
  const deploy = vi.fn(async () => ({
    provider: "vercel",
    providerDeploymentId: "dpl_208",
    providerProjectId: "prj_208",
    candidateUrl: "https://candidate.example.com",
  }));
  const statuses = [...(options.statuses ?? ["READY"])] as (string | Error)[];
  const getStatus = vi.fn(async () => {
    const status = statuses.shift() ?? "READY";
    if (status instanceof Error) throw status;
    return status;
  });
  const remove = vi.fn(async () => undefined);
  const cancel = vi.fn(async () => undefined);
  const deploymentProvider = {
    deploy,
    getStatus,
    getLogs: vi.fn(async () => [{ occurredAt: "2026-08-09T20:00:00.000Z", level: "error", message: "internal provider log" }]),
    cancel,
    remove,
  } as unknown as DeploymentProvider;
  const eventSink = { emit: async (event: DeploymentEventV1) => { events.push(event); } };
  const cleanup = new CleanupCoordinator({ executionProvider, deploymentProvider, events: eventSink, now: () => new Date(timestamp) });
  const checkpoints = new InMemoryWorkerCheckpointStore();
  const verify = vi.fn(options.verify ?? (async () => ({ publicUrl: "https://live.example.com", status: 200, contentType: "text/html" })));
  const pipeline = new WorkerPipeline({
    artifacts,
    checkpoints,
    cleanup,
    deploymentProvider,
    events: eventSink,
    executionProvider,
    processor: new DefaultStaticProjectProcessor(),
    states: { transition: async (transition) => { transitions.push(transition); } },
    usage: { record: async (report) => { usage.push(report); } },
    ...(options.cancellation ? { cancellation: { isCancellationRequested: options.cancellation } } : {}),
    verify,
    wait: async () => undefined,
    now: options.now ?? (() => timestamp),
    providerPollIntervalMilliseconds: 1,
    providerWaitTimeoutMilliseconds: 1_000,
    ...(options.workflowTimeoutMilliseconds === undefined ? {} : { workflowTimeoutMilliseconds: options.workflowTimeoutMilliseconds }),
  });
  return {
    artifacts,
    cancel,
    checkpoints,
    deploy,
    events,
    getStatus,
    pipeline,
    remove,
    stop,
    transitions,
    usage,
    verify,
    writeFiles,
  };
}

describe("WorkerPipeline", () => {
  it("runs the valid PC-200 fixture through every static stage and publishes only after verification", async () => {
    const context = setup({ statuses: ["PENDING", "BUILDING", "READY"] });
    await expect(context.pipeline.run(job)).resolves.toEqual({
      state: "READY",
      publicUrl: "https://live.example.com",
      changes: [],
    });
    expect(context.transitions.map((transition) => transition.state)).toEqual([
      "SANDBOX_STARTING",
      "ANALYZING",
      "NORMALIZING",
      "VALIDATING",
      "READY_TO_DEPLOY",
      "DEPLOYING",
      "VERIFYING",
      "READY",
    ]);
    expect(context.writeFiles).toHaveBeenCalledTimes(2);
    expect(context.deploy).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "deployment-208" }));
    expect(context.verify).toHaveBeenCalledWith("https://candidate.example.com");
    expect(context.stop).toHaveBeenCalledWith("sandbox-208");
    expect(context.remove).not.toHaveBeenCalled();
    expect(context.events.at(-1)).toMatchObject({ code: "DEPLOYMENT_READY", customerMessage: "App ready" });
    expect(context.events).toContainEqual(expect.objectContaining({ code: "PLATFORM_CHECKS_PASSED" }));
    expect(context.usage.map((report) => report.metric)).toEqual(expect.arrayContaining([
      "sandbox_creation",
      "sandbox_active_milliseconds",
      "sandbox_memory_gb_milliseconds",
      "provider_deployment",
    ]));
  });

  it("resumes after a retryable provider failure without duplicating artifacts or deployments", async () => {
    const retryable = new PocketCloudError({ code: "PROVIDER_RATE_LIMITED", customerMessage: "Provider busy.", retryable: true, retryAfterSeconds: 1 });
    const context = setup({ statuses: [retryable, "READY"] });
    await expect(context.pipeline.run(job)).rejects.toBe(retryable);
    await expect(context.pipeline.run({ ...job, attempt: 2 })).resolves.toMatchObject({ state: "READY" });
    expect(context.artifacts.writeCount).toBe(1);
    expect(context.artifacts.readOriginalCount).toBe(1);
    expect(context.deploy).toHaveBeenCalledTimes(1);
    expect(context.events).toContainEqual(expect.objectContaining({ code: "RETRY_SCHEDULED" }));
  });

  it("records deterministic failures and always stops the sandbox", async () => {
    const context = setup({ archive: new TextEncoder().encode("not a zip") });
    await expect(context.pipeline.run(job)).rejects.toMatchObject({ code: "ARCHIVE_UNSAFE_PATH", retryable: false });
    expect(context.transitions.at(-1)).toMatchObject({ state: "FAILED", error: expect.objectContaining({ code: "ARCHIVE_UNSAFE_PATH" }) });
    expect(context.stop).toHaveBeenCalledTimes(1);
    expect(context.remove).not.toHaveBeenCalled();
    await expect(context.pipeline.run({ ...job, attempt: 2 })).rejects.toMatchObject({ code: "ARCHIVE_UNSAFE_PATH" });
    expect(context.stop).toHaveBeenCalledTimes(1);
  });

  it("cancels between stages and stops the sandbox", async () => {
    let checks = 0;
    const context = setup({ cancellation: async () => {
      checks += 1;
      return checks >= 2;
    } });
    await expect(context.pipeline.run(job)).resolves.toEqual({ state: "CANCELLED", changes: [] });
    expect(context.transitions.at(-1)).toMatchObject({ state: "CANCELLED" });
    expect(context.stop).toHaveBeenCalledTimes(1);
    expect(context.deploy).not.toHaveBeenCalled();
  });

  it("removes an unverified provider deployment on provider or verification failure", async () => {
    const providerFailure = setup({ statuses: ["FAILED"] });
    await expect(providerFailure.pipeline.run(job)).rejects.toMatchObject({ code: "PROVIDER_DEPLOYMENT_FAILED" });
    expect(providerFailure.remove).toHaveBeenCalledWith("dpl_208");
    expect(providerFailure.events).toContainEqual(expect.objectContaining({
      code: "PROVIDER_DEPLOYMENT_FAILED",
      internalMetadata: expect.objectContaining({ logs: expect.any(Array) }),
    }));

    const verificationFailure = setup({ verify: async () => {
      throw new PocketCloudError({ code: "VERIFICATION_FAILED", customerMessage: "The deployed page failed its final check.", retryable: false });
    } });
    await expect(verificationFailure.pipeline.run(job)).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    expect(verificationFailure.remove).toHaveBeenCalledWith("dpl_208");
    expect(verificationFailure.stop).toHaveBeenCalledTimes(1);
  });

  it("cleans up after a workflow timeout while preserving retryable state", async () => {
    let clock = timestamp;
    const context = setup({
      now: () => {
        clock += 10;
        return clock;
      },
      workflowTimeoutMilliseconds: 1,
    });
    await expect(context.pipeline.run(job)).rejects.toMatchObject({ code: "INTERNAL_RETRYABLE", retryable: true });
    expect(context.stop).toHaveBeenCalledTimes(1);
    expect(context.transitions.some((transition) => transition.state === "FAILED")).toBe(false);
  });

  it("does not replace a READY outcome when sandbox cleanup fails", async () => {
    const context = setup({ stop: async () => { throw new Error("temporary cleanup failure"); } });
    await expect(context.pipeline.run(job)).resolves.toMatchObject({ state: "READY", publicUrl: "https://live.example.com" });
    expect(context.transitions.at(-1)).toMatchObject({ state: "READY" });
    expect(context.events).toContainEqual(expect.objectContaining({ code: "CLEANUP_FAILED", type: "warning" }));
  });
});
