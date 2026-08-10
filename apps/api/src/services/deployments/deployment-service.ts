import {
  PocketCloudError,
  type CreateDeploymentV1,
  type DeploymentCreatedV1,
  type DeploymentStatusV1,
} from "@pocketcloud/core";
import {
  AppRepository,
  DeploymentEventRepository,
  DeploymentJobRepository,
  DeploymentRepository,
  NormalizationChangeRepository,
  QuotaRepository,
  type TransactionalSqlExecutor,
  UsageRepository,
  VersionRepository,
} from "@pocketcloud/platform";

import { defaultIdFactory, type IdFactory } from "../ids";
import {
  assertWithinDeploymentQuota,
  defaultPrototypeQuotaPolicy,
  type PrototypeQuotaPolicy,
} from "../quotas/quota-policy";
import { presentCustomerError, presentCustomerEvent } from "./customer-presentation";

export interface DeploymentServiceOptions {
  database: TransactionalSqlExecutor;
  deploymentDispatcher?: DeploymentDispatcher;
  idFactory?: IdFactory;
  quotaPolicy?: PrototypeQuotaPolicy;
}

export interface DeploymentDispatcher {
  enqueue(deploymentId: string): Promise<void>;
}

export class DeploymentService {
  private readonly database: TransactionalSqlExecutor;
  private readonly deploymentDispatcher: DeploymentDispatcher | undefined;
  private readonly ids: IdFactory;
  private readonly quotaPolicy: PrototypeQuotaPolicy;

  constructor(options: DeploymentServiceOptions) {
    this.database = options.database;
    this.deploymentDispatcher = options.deploymentDispatcher;
    this.ids = options.idFactory ?? defaultIdFactory;
    this.quotaPolicy = options.quotaPolicy ?? defaultPrototypeQuotaPolicy;
  }

  async create(
    actorKey: string,
    idempotencyKey: string,
    input: CreateDeploymentV1,
  ): Promise<DeploymentCreatedV1> {
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new PocketCloudError({
        code: "REQUEST_INVALID",
        customerMessage: "A valid idempotency key is required.",
        retryable: false,
      });
    }

    const deployment = await this.database.transaction<DeploymentCreatedV1>(async (transaction) => {
      const deployments = new DeploymentRepository(transaction);
      const quota = new QuotaRepository(transaction);
      await quota.lockActor(actorKey);

      const existing = await deployments.findByIdempotencyKey(actorKey, idempotencyKey);
      if (existing) {
        return { schemaVersion: 1, deploymentId: existing.id, status: existing.status };
      }

      const version = await new VersionRepository(transaction).findById(input.versionId);
      if (!version || !version.originalArtifactId) {
        throw new PocketCloudError({
          code: "ARTIFACT_INCOMPLETE",
          customerMessage: "Finish uploading the ZIP before starting a deployment.",
          retryable: false,
        });
      }
      const app = await new AppRepository(transaction).findById(version.appId);
      if (!app || app.actorKey !== actorKey) {
        throw new PocketCloudError({
          code: "NOT_FOUND",
          customerMessage: "That app version could not be found.",
          retryable: false,
        });
      }
      if (app.status !== "ACTIVE") {
        throw new PocketCloudError({
          code: "DEPLOYMENT_SUSPENDED",
          customerMessage: "This app is suspended and cannot be deployed.",
          retryable: false,
        });
      }

      assertWithinDeploymentQuota(await quota.snapshot(actorKey), this.quotaPolicy);

      const deploymentId = this.ids.create("dep");
      const deployment = await deployments.create({
        id: deploymentId,
        actorKey,
        appId: app.id,
        versionId: version.id,
        idempotencyKey,
      });
      const events = new DeploymentEventRepository(transaction);
      await events.append({
        id: this.ids.create("evt"),
        deploymentId,
        type: "progress",
        code: "UPLOAD_RECEIVED",
        customerMessage: "Upload received",
      });
      const queued = await deployments.transition({ id: deploymentId, to: "QUEUED" });
      if (!queued) {
        throw new Error("New deployment disappeared before it could be queued");
      }
      await events.append({
        id: this.ids.create("evt"),
        deploymentId,
        type: "state",
        code: "QUEUED",
        customerMessage: "Checking your project",
      });
      await new DeploymentJobRepository(transaction).enqueue({
        id: this.ids.create("job"),
        deploymentId,
        maxAttempts: 3,
      });
      await new UsageRepository(transaction).record({
        id: this.ids.create("use"),
        actorKey,
        deploymentId,
        metric: "deployment",
        quantity: 1,
      });

      return { schemaVersion: 1 as const, deploymentId: deployment.id, status: queued.status };
    });

    await this.deploymentDispatcher?.enqueue(deployment.deploymentId);
    return deployment;
  }

  async getStatus(actorKey: string, deploymentId: string): Promise<DeploymentStatusV1> {
    const deployment = await new DeploymentRepository(this.database).findById(deploymentId);
    if (!deployment || deployment.actorKey !== actorKey) {
      throw new PocketCloudError({
        code: "NOT_FOUND",
        customerMessage: "That deployment could not be found.",
        retryable: false,
      });
    }
    const events = await new DeploymentEventRepository(this.database).listCustomerVisible(
      deployment.id,
    );
    const changes = await new NormalizationChangeRepository(this.database).listForVersion(
      deployment.versionId,
    );
    const error = deployment.errorCode
      ? presentCustomerError(deployment.errorCode, {
          ...(deployment.errorRetryable === null
            ? {}
            : { retryable: deployment.errorRetryable }),
          ...(deployment.errorRetryAfterSeconds === null
            ? {}
            : { retryAfterSeconds: deployment.errorRetryAfterSeconds }),
        })
      : null;

    return {
      schemaVersion: 1,
      deploymentId: deployment.id,
      appId: deployment.appId,
      versionId: deployment.versionId,
      status: deployment.status,
      publicUrl: deployment.status === "READY" ? deployment.publicUrl : null,
      error,
      events: events.map((event) => ({
        sequence: event.sequence,
        type: event.type,
        code: event.code,
        customerMessage: presentCustomerEvent(event),
        occurredAt: event.occurredAt,
      })),
      changes,
    };
  }
}
