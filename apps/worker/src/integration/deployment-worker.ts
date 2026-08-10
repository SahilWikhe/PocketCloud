import {
  PocketCloudError,
  type DeploymentProvider,
  type ExecutionProvider,
  type PocketCloudErrorShape,
} from "@pocketcloud/core";
import type { AiRepairClient } from "@pocketcloud/normalizer";
import {
  PlatformArtifactStore,
  PostgresDeploymentQueue,
  type PrivateObjectStorage,
  type TransactionalSqlExecutor,
} from "@pocketcloud/platform";

import { CleanupCoordinator } from "../workflows/cleanup";
import { DefaultStaticProjectProcessor } from "../workflows/static-project";
import {
  WorkerPipeline,
  type DeploymentStateSink,
  type WorkerPipelineOptions,
} from "../workflows/worker-pipeline";
import {
  PostgresCancellationSignal,
  PostgresDeploymentEventSink,
  PostgresDeploymentStateSink,
  PostgresUsageSink,
  PostgresWorkerCheckpointStore,
} from "./platform-adapters";

export type DeploymentWorkerRunResult =
  | { status: "idle" }
  | { status: "completed"; deploymentId: string; publicUrl: string }
  | { status: "cancelled"; deploymentId: string }
  | {
      status: "retry_scheduled";
      deploymentId: string;
      error: PocketCloudErrorShape;
      delaySeconds: number;
    }
  | { status: "failed"; deploymentId: string; error: PocketCloudErrorShape };

export interface DeploymentWorkerLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export interface DeploymentWorkerOptions {
  queue: PostgresDeploymentQueue;
  pipeline: WorkerPipeline;
  states: DeploymentStateSink;
  workerId: string;
  leaseSeconds?: number;
  heartbeatIntervalMilliseconds?: number;
  logger?: DeploymentWorkerLogger;
}

const silentLogger: DeploymentWorkerLogger = {
  info() {},
  warn() {},
  error() {},
};

function asPocketCloudError(error: unknown): PocketCloudError {
  if (error instanceof PocketCloudError) return error;
  return new PocketCloudError({
    code: "INTERNAL_RETRYABLE",
    customerMessage: "PocketCloud could not finish this deployment. Please try again.",
    retryable: true,
  });
}

function retryDelaySeconds(error: PocketCloudError, attempt: number): number {
  if (error.retryAfterSeconds !== undefined) {
    return Math.min(60, Math.max(1, error.retryAfterSeconds));
  }
  return Math.min(60, 2 ** Math.max(0, attempt - 1));
}

export class DeploymentWorker {
  private readonly leaseSeconds: number;
  private readonly heartbeatIntervalMilliseconds: number;
  private readonly logger: DeploymentWorkerLogger;

  constructor(private readonly options: DeploymentWorkerOptions) {
    this.leaseSeconds = options.leaseSeconds ?? 30;
    this.heartbeatIntervalMilliseconds =
      options.heartbeatIntervalMilliseconds ?? Math.max(1_000, this.leaseSeconds * 1_000 / 3);
    this.logger = options.logger ?? silentLogger;
  }

  async runOnce(): Promise<DeploymentWorkerRunResult> {
    const claimed = await this.options.queue.claim(this.options.workerId, this.leaseSeconds);
    if (!claimed) return { status: "idle" };

    const { job } = claimed;
    let heartbeatTask = Promise.resolve();
    let claimLost = false;
    const heartbeat = setInterval(() => {
      heartbeatTask = heartbeatTask.then(async () => {
        const extended = await this.options.queue.heartbeat(
          job.jobId,
          this.options.workerId,
          this.leaseSeconds,
        );
        if (!extended && !claimLost) {
          claimLost = true;
          this.logger.warn("Deployment job heartbeat lost", {
            deploymentId: job.deploymentId,
          });
        }
      }).catch(() => {
        if (!claimLost) {
          claimLost = true;
          this.logger.warn("Deployment job heartbeat failed", {
            deploymentId: job.deploymentId,
          });
        }
      });
    }, this.heartbeatIntervalMilliseconds);
    heartbeat.unref();

    try {
      await this.options.states.transition({ deploymentId: job.deploymentId, state: "CLAIMED" });
      const result = await this.options.pipeline.run(job);

      if (result.state === "CANCELLED") {
        const cancelled = await this.options.queue.cancel(job.jobId, this.options.workerId);
        if (!cancelled) throw new Error("Cancelled deployment job no longer belongs to this worker");
        this.logger.info("Deployment cancelled", { deploymentId: job.deploymentId });
        return { status: "cancelled", deploymentId: job.deploymentId };
      }

      const completed = await this.options.queue.complete(job.jobId, this.options.workerId);
      if (!completed) throw new Error("Completed deployment job no longer belongs to this worker");
      if (!result.publicUrl) throw new Error("Ready deployment did not return a verified URL");
      this.logger.info("Deployment completed", { deploymentId: job.deploymentId });
      return {
        status: "completed",
        deploymentId: job.deploymentId,
        publicUrl: result.publicUrl,
      };
    } catch (error) {
      const mapped = asPocketCloudError(error);
      const shape = mapped.toShape();
      if (mapped.retryable && job.attempt < job.maxAttempts) {
        const delaySeconds = retryDelaySeconds(mapped, job.attempt);
        const scheduled = await this.options.queue.retry({
          jobId: job.jobId,
          workerId: this.options.workerId,
          errorCode: mapped.code,
          delaySeconds,
        });
        if (!scheduled) {
          throw new Error("Retryable deployment job no longer belongs to this worker", {
            cause: error,
          });
        }
        this.logger.warn("Deployment retry scheduled", {
          deploymentId: job.deploymentId,
          errorCode: mapped.code,
          delaySeconds,
        });
        return {
          status: "retry_scheduled",
          deploymentId: job.deploymentId,
          error: shape,
          delaySeconds,
        };
      }

      await this.options.states.transition({
        deploymentId: job.deploymentId,
        state: "FAILED",
        error: shape,
      });
      const failed = await this.options.queue.fail({
        jobId: job.jobId,
        workerId: this.options.workerId,
        errorCode: mapped.code,
      });
      if (!failed) {
        throw new Error("Failed deployment job no longer belongs to this worker", {
          cause: error,
        });
      }
      this.logger.error("Deployment failed", {
        deploymentId: job.deploymentId,
        errorCode: mapped.code,
      });
      return { status: "failed", deploymentId: job.deploymentId, error: shape };
    } finally {
      clearInterval(heartbeat);
      await heartbeatTask;
    }
  }
}

export interface CreateDeploymentWorkerOptions {
  database: TransactionalSqlExecutor;
  storage: PrivateObjectStorage;
  executionProvider: ExecutionProvider;
  deploymentProvider: DeploymentProvider;
  workerId: string;
  aiClient?: AiRepairClient;
  logger?: DeploymentWorkerLogger;
  globalConcurrency?: number;
  leaseSeconds?: number;
  heartbeatIntervalMilliseconds?: number;
  verify?: WorkerPipelineOptions["verify"];
  wait?: WorkerPipelineOptions["wait"];
  now?: WorkerPipelineOptions["now"];
  workflowTimeoutMilliseconds?: number;
  providerPollIntervalMilliseconds?: number;
  providerWaitTimeoutMilliseconds?: number;
}

export function createDeploymentWorker(options: CreateDeploymentWorkerOptions): DeploymentWorker {
  const events = new PostgresDeploymentEventSink(options.database);
  const states = new PostgresDeploymentStateSink(options.database);
  const checkpoints = new PostgresWorkerCheckpointStore(options.database);
  const cleanup = new CleanupCoordinator({
    executionProvider: options.executionProvider,
    deploymentProvider: options.deploymentProvider,
    events,
  });
  const pipeline = new WorkerPipeline({
    artifacts: new PlatformArtifactStore({ database: options.database, storage: options.storage }),
    checkpoints,
    cleanup,
    deploymentProvider: options.deploymentProvider,
    events,
    executionProvider: options.executionProvider,
    processor: new DefaultStaticProjectProcessor(options.aiClient),
    states,
    usage: new PostgresUsageSink(options.database),
    cancellation: new PostgresCancellationSignal(options.database),
    ...(options.verify === undefined ? {} : { verify: options.verify }),
    ...(options.wait === undefined ? {} : { wait: options.wait }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.workflowTimeoutMilliseconds === undefined
      ? {}
      : { workflowTimeoutMilliseconds: options.workflowTimeoutMilliseconds }),
    ...(options.providerPollIntervalMilliseconds === undefined
      ? {}
      : { providerPollIntervalMilliseconds: options.providerPollIntervalMilliseconds }),
    ...(options.providerWaitTimeoutMilliseconds === undefined
      ? {}
      : { providerWaitTimeoutMilliseconds: options.providerWaitTimeoutMilliseconds }),
  });
  return new DeploymentWorker({
    queue: new PostgresDeploymentQueue(options.database, options.globalConcurrency),
    pipeline,
    states,
    workerId: options.workerId,
    ...(options.leaseSeconds === undefined ? {} : { leaseSeconds: options.leaseSeconds }),
    ...(options.heartbeatIntervalMilliseconds === undefined
      ? {}
      : { heartbeatIntervalMilliseconds: options.heartbeatIntervalMilliseconds }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}
