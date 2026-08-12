import { PocketCloudError, type DeploymentProvider } from "@pocketcloud/core";
import {
  AppRepository,
  DeploymentEventRepository,
  DeploymentJobRepository,
  DeploymentRepository,
  OperatorActionRepository,
  type TransactionalSqlExecutor,
} from "@pocketcloud/platform";

import { defaultIdFactory, type IdFactory } from "../ids";

export type DeploymentRemovalProvider = Pick<DeploymentProvider, "remove">;

export interface SuspensionServiceOptions {
  database: TransactionalSqlExecutor;
  deploymentProvider: DeploymentRemovalProvider;
  idFactory?: IdFactory;
}

export interface OperatorActionResult {
  appId: string;
  appStatus: "ACTIVE" | "SUSPENDED";
  actionId: string;
  affectedDeployments: number;
}

export class SuspensionService {
  private readonly database: TransactionalSqlExecutor;
  private readonly deploymentProvider: DeploymentRemovalProvider;
  private readonly ids: IdFactory;

  constructor(options: SuspensionServiceOptions) {
    this.database = options.database;
    this.deploymentProvider = options.deploymentProvider;
    this.ids = options.idFactory ?? defaultIdFactory;
  }

  async suspend(input: {
    appId: string;
    operatorActor: string;
    reason: string;
  }): Promise<OperatorActionResult> {
    const actionId = this.ids.create("opa");
    const prepared = await this.database.transaction(async (transaction) => {
      const apps = new AppRepository(transaction);
      const app = await apps.findByIdForUpdate(input.appId);
      if (!app) {
        throw new PocketCloudError({
          code: "NOT_FOUND",
          customerMessage: "That app could not be found.",
          retryable: false,
        });
      }
      if (app.status === "DELETED") {
        throw new PocketCloudError({
          code: "CONFLICT",
          customerMessage: "A deleted app cannot be suspended.",
          retryable: false,
        });
      }

      const deployments = new DeploymentRepository(transaction);
      const suspendable = await deployments.listSuspendableForApp(input.appId);
      const providerDeploymentIds = suspendable
        .map((deployment) => deployment.providerDeploymentId)
        .filter((id): id is string => id !== null);

      await apps.setStatus(input.appId, "SUSPENDED", "OPERATOR");
      await new DeploymentJobRepository(transaction).cancelForApp(input.appId);
      const events = new DeploymentEventRepository(transaction);
      for (const deployment of suspendable) {
        await deployments.transition({
          id: deployment.id,
          to: "SUSPENDED",
          operatorSuspension: true,
          errorCode: "DEPLOYMENT_SUSPENDED",
          errorSummary: "This app was suspended by a PocketCloud operator.",
          errorRetryable: false,
        });
        await events.append({
          id: this.ids.create("evt"),
          deploymentId: deployment.id,
          type: "error",
          code: "DEPLOYMENT_SUSPENDED",
          customerMessage: "This app has been suspended.",
        });
      }
      await new OperatorActionRepository(transaction).create({
        id: actionId,
        appId: input.appId,
        operatorActor: input.operatorActor,
        action: "SUSPEND",
        reason: input.reason,
        providerCleanupStatus: providerDeploymentIds.length > 0 ? "PENDING" : "NOT_REQUIRED",
      });
      return { providerDeploymentIds, affectedDeployments: suspendable.length };
    });

    if (prepared.providerDeploymentIds.length > 0) {
      const results = await Promise.allSettled(
        [...new Set(prepared.providerDeploymentIds)].map((providerDeploymentId) =>
          this.deploymentProvider.remove(providerDeploymentId),
        ),
      );
      const cleanupFailed = results.some((result) => result.status === "rejected");
      await new OperatorActionRepository(this.database).finishCleanup(
        actionId,
        cleanupFailed ? "FAILED" : "COMPLETED",
        ...(cleanupFailed ? ["Provider removal failed; inspect correlated operator logs."] : []),
      );
      if (cleanupFailed) {
        throw new PocketCloudError({
          code: "INTERNAL_RETRYABLE",
          customerMessage:
            "The app is suspended, but its public link still needs operator attention.",
          retryable: true,
        });
      }
    }

    return {
      appId: input.appId,
      appStatus: "SUSPENDED",
      actionId,
      affectedDeployments: prepared.affectedDeployments,
    };
  }

  async reenable(input: {
    appId: string;
    operatorActor: string;
    reason: string;
  }): Promise<OperatorActionResult> {
    return this.database.transaction(async (transaction) => {
      const apps = new AppRepository(transaction);
      const app = await apps.findByIdForUpdate(input.appId);
      if (!app) {
        throw new PocketCloudError({
          code: "NOT_FOUND",
          customerMessage: "That app could not be found.",
          retryable: false,
        });
      }
      if (app.status === "DELETED") {
        throw new PocketCloudError({
          code: "CONFLICT",
          customerMessage: "A deleted app cannot be re-enabled.",
          retryable: false,
        });
      }
      const actionId = this.ids.create("opa");
      await apps.setStatus(input.appId, "ACTIVE");
      await new OperatorActionRepository(transaction).create({
        id: actionId,
        appId: input.appId,
        operatorActor: input.operatorActor,
        action: "REENABLE",
        reason: input.reason,
        providerCleanupStatus: "NOT_REQUIRED",
      });
      return {
        appId: input.appId,
        appStatus: "ACTIVE",
        actionId,
        affectedDeployments: 0,
      };
    });
  }
}
