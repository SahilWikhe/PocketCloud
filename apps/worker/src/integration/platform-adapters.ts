import { randomUUID } from "node:crypto";

import {
  deploymentEventV1Schema,
  deploymentStateSchema,
  isTerminalDeploymentState,
  normalizationChangeV1Schema,
  pocketCloudErrorShapeSchema,
  projectPlanV1Schema,
  usageReportV1Schema,
  type DeploymentEventSink,
  type DeploymentState,
  type UsageSink,
} from "@pocketcloud/core";
import {
  AppRepository,
  DeploymentEventRepository,
  DeploymentRepository,
  DeploymentWorkerCheckpointRepository,
  NormalizationChangeRepository,
  type TransactionalSqlExecutor,
  UsageRepository,
  VersionRepository,
} from "@pocketcloud/platform";
import { z } from "zod";

import type {
  CancellationSignal,
  DeploymentStateSink,
  WorkerCheckpoint,
  WorkerCheckpointStore,
  WorkerStateTransition,
} from "../workflows/worker-pipeline";

const providerDeploymentSchema = z.object({
  provider: z.string().min(1),
  providerDeploymentId: z.string().min(1),
  providerProjectId: z.string().min(1).optional(),
  candidateUrl: z.url().optional(),
});

const workerCheckpointSchema = z.object({
  lastState: deploymentStateSchema.optional(),
  environmentId: z.string().min(1).optional(),
  sandboxCreatedAtMilliseconds: z.number().nonnegative().optional(),
  normalizedArtifactId: z.string().min(1).optional(),
  providerDeployment: providerDeploymentSchema.optional(),
  projectPlan: projectPlanV1Schema.optional(),
  changes: z.array(normalizationChangeV1Schema).readonly().optional(),
  verifiedUrl: z.url().optional(),
  terminalState: z.enum(["READY", "FAILED", "CANCELLED"]).optional(),
  terminalError: pocketCloudErrorShapeSchema.optional(),
}).strict();

const processingOrder: readonly DeploymentState[] = [
  "CREATED",
  "UPLOADING",
  "QUARANTINED",
  "QUEUED",
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

function checkpoint(value: unknown): WorkerCheckpoint {
  return workerCheckpointSchema.parse(value) as WorkerCheckpoint;
}

function processingStatus(
  state: DeploymentState,
  currentStatus: string,
): string | undefined {
  if (state === "SANDBOX_STARTING" || state === "ANALYZING" || state === "VALIDATING") {
    return "PLATFORM_CHECKING";
  }
  if (state === "NORMALIZING") return "NORMALIZING";
  if (state === "READY_TO_DEPLOY" || state === "DEPLOYING" || state === "VERIFYING") {
    return "PLATFORM_CHECKS_PASSED";
  }
  if (state === "READY") return "DEPLOYED";
  if (state === "SUSPENDED") return "SUSPENDED";
  if (
    state === "FAILED" &&
    ["UPLOADING", "QUARANTINED", "PLATFORM_CHECKING", "NORMALIZING"].includes(currentStatus)
  ) {
    return "PLATFORM_REJECTED";
  }
  return undefined;
}

export class PostgresWorkerCheckpointStore implements WorkerCheckpointStore {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async load(deploymentId: string): Promise<WorkerCheckpoint | null> {
    const stored = await new DeploymentWorkerCheckpointRepository(this.database).load(deploymentId);
    return stored === null ? null : checkpoint(stored);
  }

  async save(deploymentId: string, input: WorkerCheckpoint): Promise<void> {
    const parsed = checkpoint(input);
    await this.database.transaction(async (transaction) => {
      const deployment = await new DeploymentRepository(transaction).findByIdForUpdate(deploymentId);
      if (!deployment) throw new Error("Cannot checkpoint a missing deployment");

      if (parsed.normalizedArtifactId !== undefined || parsed.projectPlan !== undefined) {
        const version = await new VersionRepository(transaction).recordWorkerOutput({
          versionId: deployment.versionId,
          ...(parsed.normalizedArtifactId === undefined
            ? {}
            : { normalizedArtifactId: parsed.normalizedArtifactId }),
          ...(parsed.projectPlan === undefined ? {} : { projectPlan: parsed.projectPlan }),
        });
        if (!version) throw new Error("Worker output conflicts with the immutable app version");
      }

      if (parsed.providerDeployment !== undefined) {
        await new DeploymentRepository(transaction).setProviderResult({
          id: deploymentId,
          providerDeploymentId: parsed.providerDeployment.providerDeploymentId,
          ...(parsed.providerDeployment.providerProjectId === undefined
            ? {}
            : { providerProjectId: parsed.providerDeployment.providerProjectId }),
        });
      }

      const changes = new NormalizationChangeRepository(transaction);
      for (const change of parsed.changes ?? []) {
        await changes.record(deployment.versionId, change);
      }

      await new DeploymentWorkerCheckpointRepository(transaction).save(deploymentId, parsed);
    });
  }
}

export class PostgresDeploymentEventSink implements DeploymentEventSink {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async emit(input: Parameters<DeploymentEventSink["emit"]>[0]): Promise<void> {
    const event = deploymentEventV1Schema.parse(input);
    await new DeploymentEventRepository(this.database).append({
      id: `evt_${randomUUID()}`,
      deploymentId: event.deploymentId,
      type: event.type,
      code: event.code,
      customerMessage: event.customerMessage,
      occurredAt: event.occurredAt,
      ...(event.internalMetadata === undefined
        ? {}
        : { internalMetadata: event.internalMetadata }),
    });
  }
}

export class PostgresUsageSink implements UsageSink {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async record(input: Parameters<UsageSink["record"]>[0]): Promise<void> {
    const report = usageReportV1Schema.parse(input);
    await this.database.transaction(async (transaction) => {
      const deployment = await new DeploymentRepository(transaction).findById(report.deploymentId);
      if (!deployment) throw new Error("Cannot record usage for a missing deployment");
      await new UsageRepository(transaction).record({
        id: `use_${randomUUID()}`,
        actorKey: deployment.actorKey,
        deploymentId: deployment.id,
        metric: report.metric,
        quantity: report.quantity,
        occurredAt: report.occurredAt,
        ...(report.provider === undefined ? {} : { provider: report.provider }),
      });
    });
  }
}

export class PostgresDeploymentStateSink implements DeploymentStateSink {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async transition(input: WorkerStateTransition): Promise<void> {
    const target = deploymentStateSchema.parse(input.state);
    await this.database.transaction(async (transaction) => {
      const deployments = new DeploymentRepository(transaction);
      const current = await deployments.findByIdForUpdate(input.deploymentId);
      if (!current) throw new Error("Cannot transition a missing deployment");
      if (isTerminalDeploymentState(current.status) && current.status !== target) return;
      const currentIndex = processingOrder.indexOf(current.status);
      const targetIndex = processingOrder.indexOf(target);
      if (currentIndex >= 0 && targetIndex >= 0 && targetIndex < currentIndex) return;
      if (
        target === "READY" &&
        (input.publicUrl === undefined ||
          (input.providerDeployment === undefined && current.providerDeploymentId === null))
      ) {
        throw new Error("A ready deployment requires a verified URL and provider deployment ID");
      }

      if (input.providerDeployment !== undefined) {
        await deployments.setProviderResult({
          id: current.id,
          providerDeploymentId: input.providerDeployment.providerDeploymentId,
          ...(input.providerDeployment.providerProjectId === undefined
            ? {}
            : { providerProjectId: input.providerDeployment.providerProjectId }),
          ...(input.publicUrl === undefined ? {} : { publicUrl: input.publicUrl }),
        });
      } else if (input.publicUrl !== undefined) {
        throw new Error("A verified URL cannot be stored without a provider deployment");
      }

      if (current.status !== target && !isTerminalDeploymentState(current.status)) {
        if (target === "FAILED" || target === "CANCELLED") {
          await deployments.transition({
            id: current.id,
            to: target,
            ...(input.error === undefined
              ? {}
                : {
                    errorCode: input.error.code,
                    errorSummary: input.error.customerMessage,
                    errorRetryable: input.error.retryable,
                    ...(input.error.retryAfterSeconds === undefined
                      ? {}
                      : { errorRetryAfterSeconds: input.error.retryAfterSeconds }),
                  }),
          });
        } else {
          if (currentIndex < 0 || targetIndex < 0) {
            throw new Error(`Unsupported worker transition: ${current.status} -> ${target}`);
          }
          if (targetIndex > currentIndex) {
            for (const state of processingOrder.slice(currentIndex + 1, targetIndex + 1)) {
              await deployments.transition({ id: current.id, to: state });
            }
          }
        }
      }

      const version = await new VersionRepository(transaction).findById(current.versionId);
      if (!version) throw new Error("Deployment app version is missing");
      if (target === "READY" && (!version.normalizedArtifactId || !version.projectPlan)) {
        throw new Error("A ready deployment requires a persisted plan and normalized artifact");
      }
      const versionStatus = processingStatus(target, version.platformCheckStatus);
      if (versionStatus !== undefined) {
        const updated = await new VersionRepository(transaction).recordWorkerOutput({
          versionId: version.id,
          platformCheckStatus: versionStatus,
        });
        if (!updated) throw new Error("Deployment app version could not be updated");
      }
      if (target === "READY") {
        const promoted = await new AppRepository(transaction).promoteVersion(
          current.appId,
          current.versionId,
        );
        if (!promoted) throw new Error("Ready deployment belongs to an inactive app");
      }
    });
  }
}

export class PostgresCancellationSignal implements CancellationSignal {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async isCancellationRequested(deploymentId: string): Promise<boolean> {
    const deployment = await new DeploymentRepository(this.database).findById(deploymentId);
    if (!deployment || deployment.status === "CANCELLED" || deployment.status === "SUSPENDED") {
      return true;
    }
    const result = await this.database.query<{ status: string }>(
      "SELECT status FROM deployment_jobs WHERE deployment_id = $1",
      [deploymentId],
    );
    return result.rows[0]?.status === "CANCELLED";
  }
}
