import { createHash } from "node:crypto";
import path from "node:path";

import {
  deploymentJobV1Schema,
  PocketCloudError,
  type ArtifactFile,
  type ArtifactFileChunk,
  type ArtifactStore,
  type DeploymentEventSink,
  type DeploymentJobV1,
  type DeploymentProvider,
  type DeploymentState,
  type ExecutionProvider,
  type NormalizationChangeV1,
  type ProviderDeployment,
  type PocketCloudErrorShape,
  type ProjectPlanV1,
  type UsageSink,
} from "@pocketcloud/core";
import type { StaticProjectFile } from "@pocketcloud/core/execution";

import { CleanupCoordinator } from "./cleanup";
import type { StaticProjectProcessor } from "./static-project";
import { verifyHttpsDeployment, type VerifiedDeployment } from "./verification";

export interface WorkerStateTransition {
  deploymentId: string;
  state: DeploymentState;
  providerDeployment?: ProviderDeployment;
  publicUrl?: string;
  changes?: readonly NormalizationChangeV1[];
  error?: ReturnType<PocketCloudError["toShape"]>;
}

export interface DeploymentStateSink {
  transition(transition: WorkerStateTransition): Promise<void>;
}

export interface WorkerCheckpoint {
  lastState?: DeploymentState;
  environmentId?: string;
  sandboxCreatedAtMilliseconds?: number;
  normalizedArtifactId?: string;
  providerDeployment?: ProviderDeployment;
  projectPlan?: ProjectPlanV1;
  changes?: readonly NormalizationChangeV1[];
  verifiedUrl?: string;
  terminalState?: "READY" | "FAILED" | "CANCELLED";
  terminalError?: PocketCloudErrorShape;
}

export interface WorkerCheckpointStore {
  load(deploymentId: string): Promise<WorkerCheckpoint | null>;
  save(deploymentId: string, checkpoint: WorkerCheckpoint): Promise<void>;
}

export interface CancellationSignal {
  isCancellationRequested(deploymentId: string): Promise<boolean>;
}

export interface WorkerPipelineOptions {
  artifacts: ArtifactStore;
  checkpoints: WorkerCheckpointStore;
  cleanup: CleanupCoordinator;
  deploymentProvider: DeploymentProvider;
  events: DeploymentEventSink;
  executionProvider: ExecutionProvider;
  processor: StaticProjectProcessor;
  states: DeploymentStateSink;
  usage: UsageSink;
  cancellation?: CancellationSignal;
  verify?: (candidateUrl: string) => Promise<VerifiedDeployment>;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  workflowTimeoutMilliseconds?: number;
  providerPollIntervalMilliseconds?: number;
  providerWaitTimeoutMilliseconds?: number;
}

export interface WorkerPipelineResult {
  state: "READY" | "CANCELLED";
  publicUrl?: string;
  changes: readonly NormalizationChangeV1[];
}

const orderedStates: readonly DeploymentState[] = [
  "CLAIMED",
  "SANDBOX_STARTING",
  "ANALYZING",
  "NORMALIZING",
  "VALIDATING",
  "READY_TO_DEPLOY",
  "DEPLOYING",
  "VERIFYING",
  "READY",
];

const customerStateMessages: Partial<Record<DeploymentState, { code: string; message: string }>> = {
  SANDBOX_STARTING: { code: "CHECKING_PROJECT", message: "Checking your project" },
  ANALYZING: { code: "ANALYZING_PROJECT", message: "Checking your project" },
  NORMALIZING: { code: "FIXING_PROJECT", message: "Fixing issues" },
  VALIDATING: { code: "VALIDATING_PROJECT", message: "Preparing deployment" },
  READY_TO_DEPLOY: { code: "PLATFORM_CHECKS_PASSED", message: "Preparing deployment" },
  DEPLOYING: { code: "PUBLISHING_PROJECT", message: "Publishing" },
  VERIFYING: { code: "VERIFYING_PROJECT", message: "Final check" },
  READY: { code: "DEPLOYMENT_READY", message: "App ready" },
  FAILED: { code: "DEPLOYMENT_FAILED", message: "PocketCloud could not deploy this project." },
  CANCELLED: { code: "DEPLOYMENT_CANCELLED", message: "Deployment cancelled" },
};

class WorkflowCancelled extends Error {
  constructor() {
    super("Workflow cancellation requested");
    this.name = "WorkflowCancelled";
  }
}

export class InMemoryWorkerCheckpointStore implements WorkerCheckpointStore {
  private readonly checkpoints = new Map<string, WorkerCheckpoint>();

  async load(deploymentId: string): Promise<WorkerCheckpoint | null> {
    return this.checkpoints.get(deploymentId) ?? null;
  }

  async save(deploymentId: string, checkpoint: WorkerCheckpoint): Promise<void> {
    this.checkpoints.set(deploymentId, { ...checkpoint });
  }
}

function mediaType(filePath: string): string | null {
  const extension = path.posix.extname(filePath).toLowerCase();
  return ({
    ".css": "text/css",
    ".gif": "image/gif",
    ".html": "text/html",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript",
    ".json": "application/json",
    ".mjs": "text/javascript",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  } as Record<string, string>)[extension] ?? null;
}

function artifactFiles(files: readonly StaticProjectFile[]): readonly { file: ArtifactFile; bytes: Uint8Array }[] {
  return [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path: filePath, bytes }) => ({
      file: {
        path: filePath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
        mediaType: mediaType(filePath),
      },
      bytes: Uint8Array.from(bytes),
    }));
}

async function* artifactChunks(files: readonly { file: ArtifactFile; bytes: Uint8Array }[]): AsyncIterable<ArtifactFileChunk> {
  for (const { file, bytes } of files) yield { file, offset: 0, bytes };
}

async function readOriginalArchive(artifacts: ArtifactStore, artifactId: string): Promise<Uint8Array> {
  const manifest = await artifacts.getManifest(artifactId);
  if (manifest.kind !== "original" || manifest.fileCount !== 1 || !manifest.files[0]?.path.toLowerCase().endsWith(".zip")) {
    throw new PocketCloudError({ code: "ARTIFACT_INCOMPLETE", customerMessage: "The original upload artifact is incomplete.", retryable: false });
  }
  const expected = manifest.files[0];
  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let offset = 0;
  for await (const chunk of artifacts.readFiles(artifactId)) {
    if (chunk.file.path !== expected.path || chunk.offset !== offset) {
      throw new PocketCloudError({ code: "ARTIFACT_INCOMPLETE", customerMessage: "The original upload artifact is incomplete.", retryable: false });
    }
    const bytes = Uint8Array.from(chunk.bytes);
    offset += bytes.byteLength;
    if (offset > expected.size) throw new PocketCloudError({ code: "ARTIFACT_INCOMPLETE", customerMessage: "The original upload artifact is incomplete.", retryable: false });
    hash.update(bytes);
    chunks.push(bytes);
  }
  if (offset !== expected.size || hash.digest("hex") !== expected.sha256) {
    throw new PocketCloudError({ code: "ARTIFACT_INCOMPLETE", customerMessage: "The original upload artifact is incomplete.", retryable: false });
  }
  const archive = new Uint8Array(offset);
  let writeOffset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }
  return archive;
}

function artifactSource(artifacts: ArtifactStore, artifactId: string) {
  return {
    async *read(file: ArtifactFile): AsyncIterable<Uint8Array> {
      let expectedOffset = 0;
      for await (const chunk of artifacts.readFiles(artifactId)) {
        if (chunk.file.path !== file.path) continue;
        if (chunk.offset !== expectedOffset) throw new PocketCloudError({ code: "ARTIFACT_INCOMPLETE", customerMessage: "The approved artifact is incomplete.", retryable: false });
        expectedOffset += chunk.bytes.byteLength;
        yield Uint8Array.from(chunk.bytes);
      }
    },
  };
}

function asPocketCloudError(error: unknown): PocketCloudError {
  if (error instanceof PocketCloudError) return error;
  return new PocketCloudError({
    code: "INTERNAL_RETRYABLE",
    customerMessage: "PocketCloud could not finish this deployment. Please try again.",
    retryable: true,
  });
}

export class WorkerPipeline {
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly verify: (candidateUrl: string) => Promise<VerifiedDeployment>;
  private readonly workflowTimeoutMilliseconds: number;
  private readonly providerPollIntervalMilliseconds: number;
  private readonly providerWaitTimeoutMilliseconds: number;

  constructor(private readonly options: WorkerPipelineOptions) {
    this.now = options.now ?? Date.now;
    this.wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.verify = options.verify ?? ((candidateUrl) => verifyHttpsDeployment(candidateUrl));
    this.workflowTimeoutMilliseconds = options.workflowTimeoutMilliseconds ?? 120_000;
    this.providerPollIntervalMilliseconds = options.providerPollIntervalMilliseconds ?? 1_000;
    this.providerWaitTimeoutMilliseconds = options.providerWaitTimeoutMilliseconds ?? 60_000;
  }

  async run(jobInput: DeploymentJobV1): Promise<WorkerPipelineResult> {
    const job = deploymentJobV1Schema.parse(jobInput);
    const startedAt = this.now();
    let checkpoint = await this.options.checkpoints.load(job.deploymentId) ?? {};
    if (checkpoint.terminalState === "READY" && checkpoint.verifiedUrl) {
      return { state: "READY", publicUrl: checkpoint.verifiedUrl, changes: checkpoint.changes ?? [] };
    }
    if (checkpoint.terminalState === "CANCELLED") {
      return { state: "CANCELLED", changes: checkpoint.changes ?? [] };
    }
    if (checkpoint.terminalState === "FAILED" && checkpoint.terminalError) {
      throw new PocketCloudError(checkpoint.terminalError);
    }
    let cleanupOutcome: DeploymentState = checkpoint.lastState ?? "CLAIMED";
    let removeProviderDeployment = false;
    let sandboxCreatedThisRun = false;

    const save = async (patch: Partial<WorkerCheckpoint>): Promise<void> => {
      checkpoint = { ...checkpoint, ...patch };
      await this.options.checkpoints.save(job.deploymentId, checkpoint);
    };
    const checkpointDetails = (): Partial<WorkerStateTransition> => {
      const details: Partial<WorkerStateTransition> = {};
      if (checkpoint.providerDeployment) details.providerDeployment = checkpoint.providerDeployment;
      if (checkpoint.changes) details.changes = checkpoint.changes;
      return details;
    };
    const advance = async (state: DeploymentState, details: Partial<WorkerStateTransition> = {}): Promise<void> => {
      const currentRank = checkpoint.lastState ? orderedStates.indexOf(checkpoint.lastState) : -1;
      const targetRank = orderedStates.indexOf(state);
      if (targetRank >= 0 && targetRank <= currentRank) return;
      await this.options.states.transition({ deploymentId: job.deploymentId, state, ...details });
      const customer = customerStateMessages[state];
      if (customer) {
        await this.options.events.emit({
          schemaVersion: 1,
          deploymentId: job.deploymentId,
          type: state === "FAILED" ? "error" : "state",
          code: customer.code,
          customerMessage: customer.message,
          occurredAt: new Date(this.now()).toISOString(),
        });
      }
      await save({ lastState: state });
      cleanupOutcome = state;
    };
    const checkDeadline = (): void => {
      if (this.now() - startedAt > this.workflowTimeoutMilliseconds) {
        throw new PocketCloudError({ code: "INTERNAL_RETRYABLE", customerMessage: "Deployment processing timed out. Please try again.", retryable: true });
      }
    };
    const checkCancellation = async (): Promise<void> => {
      if (await this.options.cancellation?.isCancellationRequested(job.deploymentId)) throw new WorkflowCancelled();
    };

    try {
      if (!checkpoint.normalizedArtifactId) {
        await checkCancellation();
        await advance("SANDBOX_STARTING");
        const environment = await this.options.executionProvider.create({
          deploymentId: job.deploymentId,
          timeoutMilliseconds: Math.min(60_000, this.workflowTimeoutMilliseconds),
          memoryMegabytes: 2_048,
          vcpus: 1,
          networkAccess: "deny",
          exposePorts: false,
        });
        sandboxCreatedThisRun = true;
        await save({ environmentId: environment.environmentId, sandboxCreatedAtMilliseconds: this.now() });
        await this.recordUsage(job, "sandbox_creation", 1, "vercel");
        checkDeadline();
        await checkCancellation();
        const archive = await readOriginalArchive(this.options.artifacts, job.originalArtifactId);
        await this.options.executionProvider.writeFiles(environment.environmentId, [{ path: "input/source.zip", bytes: archive }]);

        await advance("ANALYZING");
        const analysis = await this.options.processor.analyze(archive);
        await save({ projectPlan: analysis.plan });
        checkDeadline();
        await checkCancellation();
        await advance("NORMALIZING");
        const normalization = await this.options.processor.normalize(analysis);
        checkDeadline();
        await checkCancellation();
        await advance("VALIDATING");
        await this.options.processor.validate(normalization);
        await this.options.executionProvider.writeFiles(
          environment.environmentId,
          normalization.files.map((file) => ({ path: `normalized/${file.path}`, bytes: file.bytes })),
        );
        if (normalization.aiUsage) {
          await this.recordUsage(job, "ai_input_tokens", normalization.aiUsage.inputTokens, "openai");
          await this.recordUsage(job, "ai_output_tokens", normalization.aiUsage.outputTokens, "openai");
        }
        const normalizedFiles = artifactFiles(normalization.files);
        const manifest = await this.options.artifacts.writeArtifact({
          kind: "normalized",
          files: artifactChunks(normalizedFiles),
        });
        await save({ normalizedArtifactId: manifest.artifactId, changes: normalization.changes });
        await advance("READY_TO_DEPLOY", { changes: normalization.changes });
      }

      checkDeadline();
      await checkCancellation();
      const normalizedArtifactId = checkpoint.normalizedArtifactId!;
      const manifest = await this.options.artifacts.getManifest(normalizedArtifactId);
      if (!checkpoint.providerDeployment) {
        await advance("DEPLOYING", checkpointDetails());
        const providerDeployment = await this.options.deploymentProvider.deploy({
          manifest,
          files: artifactSource(this.options.artifacts, normalizedArtifactId),
          idempotencyKey: job.deploymentId,
        });
        await save({ providerDeployment });
        await this.recordUsage(job, "provider_deployment", 1, providerDeployment.provider);
      }

      const providerDeployment = checkpoint.providerDeployment!;
      const providerStartedAt = this.now();
      while (true) {
        checkDeadline();
        await checkCancellation();
        const providerStatus = await this.options.deploymentProvider.getStatus(providerDeployment.providerDeploymentId);
        if (providerStatus === "READY") break;
        if (providerStatus === "FAILED") {
          const logs = await this.options.deploymentProvider.getLogs(providerDeployment.providerDeploymentId).catch(() => []);
          await this.options.events.emit({
            schemaVersion: 1,
            deploymentId: job.deploymentId,
            type: "error",
            code: "PROVIDER_DEPLOYMENT_FAILED",
            customerMessage: "The publishing provider could not finish this deployment.",
            internalMetadata: { provider: providerDeployment.provider, logs },
            occurredAt: new Date(this.now()).toISOString(),
          });
          throw new PocketCloudError({ code: "PROVIDER_DEPLOYMENT_FAILED", customerMessage: "The publishing provider could not finish this deployment.", retryable: false });
        }
        if (providerStatus === "CANCELLED") throw new WorkflowCancelled();
        if (this.now() - providerStartedAt > this.providerWaitTimeoutMilliseconds) {
          throw new PocketCloudError({ code: "INTERNAL_RETRYABLE", customerMessage: "Publishing is taking longer than expected. PocketCloud will retry.", retryable: true });
        }
        await this.wait(this.providerPollIntervalMilliseconds);
      }

      await advance("VERIFYING", checkpointDetails());
      if (!providerDeployment.candidateUrl) {
        throw new PocketCloudError({ code: "PROVIDER_DEPLOYMENT_FAILED", customerMessage: "The publishing provider did not return a deployment address.", retryable: false });
      }
      const verified = await this.verify(providerDeployment.candidateUrl);
      await advance("READY", {
        ...checkpointDetails(),
        publicUrl: verified.publicUrl,
      });
      await save({ verifiedUrl: verified.publicUrl, terminalState: "READY" });
      cleanupOutcome = "READY";
      return { state: "READY", publicUrl: verified.publicUrl, changes: checkpoint.changes ?? [] };
    } catch (error) {
      if (error instanceof WorkflowCancelled) {
        if (checkpoint.providerDeployment) {
          await this.options.deploymentProvider.cancel(checkpoint.providerDeployment.providerDeploymentId).catch(() => undefined);
          removeProviderDeployment = true;
        }
        await advance("CANCELLED", checkpointDetails());
        await save({ terminalState: "CANCELLED" });
        cleanupOutcome = "CANCELLED";
        return { state: "CANCELLED", changes: checkpoint.changes ?? [] };
      }
      const mapped = asPocketCloudError(error);
      if (mapped.retryable) {
        await this.options.events.emit({
          schemaVersion: 1,
          deploymentId: job.deploymentId,
          type: "warning",
          code: "RETRY_SCHEDULED",
          customerMessage: "PocketCloud will retry this deployment.",
          internalMetadata: { errorCode: mapped.code, attempt: job.attempt },
          occurredAt: new Date(this.now()).toISOString(),
        });
      } else {
        removeProviderDeployment = checkpoint.providerDeployment !== undefined;
        await advance("FAILED", {
          ...checkpointDetails(),
          error: mapped.toShape(),
        });
        await save({ terminalState: "FAILED", terminalError: mapped.toShape() });
        cleanupOutcome = "FAILED";
      }
      throw mapped;
    } finally {
      await this.options.cleanup.cleanup({
        deploymentId: job.deploymentId,
        ...(checkpoint.environmentId === undefined ? {} : { environmentId: checkpoint.environmentId }),
        ...(checkpoint.providerDeployment === undefined ? {} : { providerDeploymentId: checkpoint.providerDeployment.providerDeploymentId }),
        removeProviderDeployment,
        originalOutcome: cleanupOutcome,
      });
      if (sandboxCreatedThisRun && checkpoint.sandboxCreatedAtMilliseconds !== undefined) {
        const activeMilliseconds = Math.max(0, this.now() - checkpoint.sandboxCreatedAtMilliseconds);
        await this.recordUsage(job, "sandbox_active_milliseconds", activeMilliseconds, "vercel");
        await this.recordUsage(job, "sandbox_memory_gb_milliseconds", activeMilliseconds * 2, "vercel");
      }
    }
  }

  private async recordUsage(
    job: DeploymentJobV1,
    metric: "sandbox_creation" | "sandbox_active_milliseconds" | "sandbox_memory_gb_milliseconds" | "ai_input_tokens" | "ai_output_tokens" | "provider_deployment",
    quantity: number,
    provider?: string,
  ): Promise<void> {
    await this.options.usage.record({
      schemaVersion: 1,
      deploymentId: job.deploymentId,
      metric,
      quantity,
      ...(provider === undefined ? {} : { provider }),
      occurredAt: new Date(this.now()).toISOString(),
    });
  }
}
