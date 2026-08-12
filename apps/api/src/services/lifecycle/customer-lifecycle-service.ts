import {
  PocketCloudError,
  customerAppActionV1Schema,
  type CustomerAppActionV1,
  type CustomerLifecycleAction,
} from "@pocketcloud/core";
import {
  AppRepository,
  ArtifactRepository,
  CustomerAppActionRepository,
  DeploymentEventRepository,
  DeploymentJobRepository,
  DeploymentRepository,
  DeploymentWorkerCheckpointRepository,
  QuotaRepository,
  UsageRepository,
  VersionRepository,
  type AppRecord,
  type CustomerAppActionRecord,
  type TransactionalSqlExecutor,
} from "@pocketcloud/platform";

import type { CustomerContext } from "../../auth/customer";
import { defaultIdFactory, type IdFactory } from "../ids";
import type { DeploymentDispatcher } from "../deployments/deployment-service";
import { assertWithinDeploymentQuota, defaultPrototypeQuotaPolicy } from "../quotas/quota-policy";
import type { DeploymentRemovalProvider } from "../suspension/suspension-service";

const recoverableDeleteMilliseconds = 7 * 24 * 60 * 60 * 1_000;

interface PreparedCleanup {
  action: CustomerAppActionRecord;
  providerDeploymentIds: readonly string[];
}

export interface CustomerLifecycleServiceOptions {
  database: TransactionalSqlExecutor;
  deploymentProvider: DeploymentRemovalProvider;
  deploymentDispatcher?: DeploymentDispatcher;
  idFactory?: IdFactory;
  now?: () => Date;
}

function asResult(action: CustomerAppActionRecord): CustomerAppActionV1 {
  return customerAppActionV1Schema.parse({
    schemaVersion: 1,
    actionId: action.id,
    appId: action.appId,
    action: action.action,
    status: action.status,
    appStatus: action.resultingAppStatus,
    deploymentId: action.deploymentId,
    recoverableUntil: action.recoverableUntil,
    createdAt: action.createdAt,
    completedAt: action.completedAt,
  });
}

function assertManagementRole(context: CustomerContext): void {
  if (!['OWNER', 'ADMIN'].includes(context.workspace.role)) {
    throw new PocketCloudError({
      code: "UNAUTHORIZED",
      customerMessage: "Your workspace role cannot manage this project.",
      retryable: false,
    });
  }
}

function assertIdempotencyKey(idempotencyKey: string): void {
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new PocketCloudError({
      code: "REQUEST_INVALID",
      customerMessage: "A valid idempotency key is required.",
      retryable: false,
    });
  }
}

function assertOwnedApp(app: AppRecord | null, context: CustomerContext): asserts app is AppRecord {
  if (!app || app.workspaceId !== context.workspace.id) {
    throw new PocketCloudError({
      code: "NOT_FOUND",
      customerMessage: "That project could not be found.",
      retryable: false,
    });
  }
}

function assertMatchingAction(
  existing: CustomerAppActionRecord,
  appId: string,
  action: CustomerLifecycleAction,
): void {
  if (existing.appId !== appId || existing.action !== action) {
    throw new PocketCloudError({
      code: "CONFLICT",
      customerMessage: "That idempotency key was already used for another action.",
      retryable: false,
    });
  }
}

export class CustomerLifecycleService {
  private readonly database: TransactionalSqlExecutor;
  private readonly deploymentProvider: DeploymentRemovalProvider;
  private readonly deploymentDispatcher: DeploymentDispatcher | undefined;
  private readonly ids: IdFactory;
  private readonly now: () => Date;

  constructor(options: CustomerLifecycleServiceOptions) {
    this.database = options.database;
    this.deploymentProvider = options.deploymentProvider;
    this.deploymentDispatcher = options.deploymentDispatcher;
    this.ids = options.idFactory ?? defaultIdFactory;
    this.now = options.now ?? (() => new Date());
  }

  async redeploy(
    context: CustomerContext,
    appId: string,
    idempotencyKey: string,
  ): Promise<CustomerAppActionV1> {
    return this.publishApprovedVersion(context, appId, idempotencyKey, "REDEPLOY");
  }

  async restore(
    context: CustomerContext,
    appId: string,
    idempotencyKey: string,
  ): Promise<CustomerAppActionV1> {
    return this.publishApprovedVersion(context, appId, idempotencyKey, "RESTORE");
  }

  async suspend(
    context: CustomerContext,
    appId: string,
    idempotencyKey: string,
  ): Promise<CustomerAppActionV1> {
    return this.removePublicAvailability(context, appId, idempotencyKey, "SUSPEND");
  }

  async delete(
    context: CustomerContext,
    appId: string,
    idempotencyKey: string,
  ): Promise<CustomerAppActionV1> {
    return this.removePublicAvailability(context, appId, idempotencyKey, "DELETE");
  }

  private async publishApprovedVersion(
    context: CustomerContext,
    appId: string,
    idempotencyKey: string,
    action: "REDEPLOY" | "RESTORE",
  ): Promise<CustomerAppActionV1> {
    assertManagementRole(context);
    assertIdempotencyKey(idempotencyKey);

    const prepared = await this.database.transaction(async (transaction) => {
      const actions = new CustomerAppActionRepository(transaction);
      const existing = await actions.findByIdempotencyKey(context.workspace.id, idempotencyKey);
      if (existing) {
        assertMatchingAction(existing, appId, action);
        return { action: existing, dispatch: existing.deploymentId !== null };
      }

      const apps = new AppRepository(transaction);
      const app = await apps.findByIdForUpdate(appId);
      assertOwnedApp(app, context);
      if (app.suspensionSource === "OPERATOR") {
        throw new PocketCloudError({
          code: "DEPLOYMENT_SUSPENDED",
          customerMessage: "This project was suspended by PocketCloud and cannot be restored here.",
          retryable: false,
        });
      }
      if (action === "REDEPLOY" && app.status !== "ACTIVE") {
        throw new PocketCloudError({
          code: "CONFLICT",
          customerMessage: "Restore this project before redeploying it.",
          retryable: false,
        });
      }
      if (action === "RESTORE" && app.status === "ACTIVE") {
        throw new PocketCloudError({
          code: "CONFLICT",
          customerMessage: "This project is already active.",
          retryable: false,
        });
      }
      if (
        action === "RESTORE" &&
        app.status === "DELETED" &&
        (!app.recoverableUntil || new Date(app.recoverableUntil) <= this.now())
      ) {
        throw new PocketCloudError({
          code: "CONFLICT",
          customerMessage: "This project's recovery window has ended.",
          retryable: false,
        });
      }
      if (!app.activeVersionId) {
        throw new PocketCloudError({
          code: "ARTIFACT_INCOMPLETE",
          customerMessage: "This project does not have an approved version to publish.",
          retryable: false,
        });
      }

      const version = await new VersionRepository(transaction).findById(app.activeVersionId);
      if (!version?.normalizedArtifactId || !version.projectPlan) {
        throw new PocketCloudError({
          code: "ARTIFACT_INCOMPLETE",
          customerMessage: "This project's approved files are not available for publishing.",
          retryable: false,
        });
      }
      const artifact = await new ArtifactRepository(transaction).findById(version.normalizedArtifactId);
      if (!artifact || artifact.status === "DELETED") {
        throw new PocketCloudError({
          code: "ARTIFACT_INCOMPLETE",
          customerMessage: "This project's recovery files are no longer available.",
          retryable: false,
        });
      }

      const quota = new QuotaRepository(transaction);
      await quota.lockActor(context.actorKey);
      assertWithinDeploymentQuota(await quota.snapshot(context.actorKey), defaultPrototypeQuotaPolicy);

      const created = await actions.create({
        id: this.ids.create("caa"),
        workspaceId: context.workspace.id,
        userId: context.user.id,
        appId,
        action,
        idempotencyKey,
      });
      if (!created) {
        const raced = await actions.findByIdempotencyKey(context.workspace.id, idempotencyKey);
        if (!raced) throw new Error("Customer action conflict could not be recovered");
        assertMatchingAction(raced, appId, action);
        return { action: raced, dispatch: raced.deploymentId !== null };
      }

      if (action === "RESTORE") {
        await apps.setStatus(app.id, "ACTIVE");
        await new ArtifactRepository(transaction).preserveNormalizedForApp(app.id);
      }

      const deploymentId = this.ids.create("dep");
      const deployments = new DeploymentRepository(transaction);
      await deployments.create({
        id: deploymentId,
        actorKey: context.actorKey,
        appId: app.id,
        versionId: version.id,
        idempotencyKey: `customer-action:${created.id}`,
        initialState: "QUEUED",
      });
      await new DeploymentWorkerCheckpointRepository(transaction).save(deploymentId, {
        lastState: "READY_TO_DEPLOY",
        normalizedArtifactId: version.normalizedArtifactId,
        projectPlan: version.projectPlan,
      });
      await new DeploymentEventRepository(transaction).append({
        id: this.ids.create("evt"),
        deploymentId,
        type: "state",
        code: action === "RESTORE" ? "RESTORE_QUEUED" : "REDEPLOY_QUEUED",
        customerMessage: "Publishing the approved version",
      });
      await new DeploymentJobRepository(transaction).enqueue({
        id: this.ids.create("job"),
        deploymentId,
        maxAttempts: 3,
      });
      await new UsageRepository(transaction).record({
        id: this.ids.create("use"),
        actorKey: context.actorKey,
        deploymentId,
        metric: "deployment",
        quantity: 1,
      });
      const completed = await actions.complete({
        id: created.id,
        appStatus: "ACTIVE",
        deploymentId,
      });
      return { action: completed, dispatch: true };
    });

    if (prepared.dispatch && prepared.action.deploymentId) {
      await this.deploymentDispatcher?.enqueue(prepared.action.deploymentId);
    }
    return asResult(prepared.action);
  }

  private async removePublicAvailability(
    context: CustomerContext,
    appId: string,
    idempotencyKey: string,
    action: "SUSPEND" | "DELETE",
  ): Promise<CustomerAppActionV1> {
    assertManagementRole(context);
    assertIdempotencyKey(idempotencyKey);

    const prepared = await this.database.transaction<PreparedCleanup>(async (transaction) => {
      const actions = new CustomerAppActionRepository(transaction);
      const existing = await actions.findByIdempotencyKey(context.workspace.id, idempotencyKey);
      if (existing) {
        assertMatchingAction(existing, appId, action);
        const retryCleanup = ["PENDING", "FAILED"].includes(existing.providerCleanupStatus);
        return {
          action: existing,
          providerDeploymentIds: retryCleanup
            ? [...new Set(await new DeploymentRepository(transaction).listProviderDeploymentIdsForApp(appId))]
            : [],
        };
      }

      const apps = new AppRepository(transaction);
      const app = await apps.findByIdForUpdate(appId);
      assertOwnedApp(app, context);
      if (app.suspensionSource === "OPERATOR") {
        throw new PocketCloudError({
          code: "DEPLOYMENT_SUSPENDED",
          customerMessage: "This project is controlled by a PocketCloud suspension.",
          retryable: false,
        });
      }
      if (action === "SUSPEND" && app.status === "DELETED") {
        throw new PocketCloudError({
          code: "CONFLICT",
          customerMessage: "A deleted project cannot be suspended.",
          retryable: false,
        });
      }

      const deployments = new DeploymentRepository(transaction);
      const providerDeploymentIds = [
        ...new Set(await deployments.listProviderDeploymentIdsForApp(app.id)),
      ];
      const created = await actions.create({
        id: this.ids.create("caa"),
        workspaceId: context.workspace.id,
        userId: context.user.id,
        appId,
        action,
        idempotencyKey,
        providerCleanupStatus: providerDeploymentIds.length > 0 ? "PENDING" : "NOT_REQUIRED",
      });
      if (!created) {
        const raced = await actions.findByIdempotencyKey(context.workspace.id, idempotencyKey);
        if (!raced) throw new Error("Customer action conflict could not be recovered");
        assertMatchingAction(raced, appId, action);
        return { action: raced, providerDeploymentIds: [] };
      }

      const suspendable = await deployments.listSuspendableForApp(app.id);
      await new DeploymentJobRepository(transaction).cancelForApp(app.id);
      for (const deployment of suspendable) {
        await deployments.transition({
          id: deployment.id,
          to: "SUSPENDED",
          operatorSuspension: true,
          errorCode: "DEPLOYMENT_SUSPENDED",
          errorSummary: action === "DELETE" ? "This project was deleted by its owner." : "This project was suspended by its owner.",
          errorRetryable: false,
        });
        await new DeploymentEventRepository(transaction).append({
          id: this.ids.create("evt"),
          deploymentId: deployment.id,
          type: "state",
          code: action === "DELETE" ? "PROJECT_DELETED" : "DEPLOYMENT_SUSPENDED",
          customerMessage: action === "DELETE" ? "Project moved to recovery" : "Project suspended",
        });
      }

      let recoverableUntil: string | undefined;
      if (action === "DELETE") {
        recoverableUntil = app.status === "DELETED" && app.recoverableUntil
          ? app.recoverableUntil
          : new Date(this.now().getTime() + recoverableDeleteMilliseconds).toISOString();
        if (app.status !== "DELETED") await apps.softDelete(app.id, recoverableUntil);
        await new ArtifactRepository(transaction).scheduleNormalizedForApp(app.id, recoverableUntil);
      } else {
        await apps.setStatus(app.id, "SUSPENDED", "CUSTOMER");
      }

      const appStatus = action === "DELETE" ? "DELETED" : "SUSPENDED";
      const recorded = providerDeploymentIds.length > 0
        ? await actions.recordOutcome({
            id: created.id,
            appStatus,
            ...(recoverableUntil === undefined ? {} : { recoverableUntil }),
          })
        : await actions.complete({
            id: created.id,
            appStatus,
            ...(recoverableUntil === undefined ? {} : { recoverableUntil }),
            providerCleanupStatus: "NOT_REQUIRED",
          });
      return { action: recorded, providerDeploymentIds };
    });

    if (prepared.providerDeploymentIds.length === 0) return asResult(prepared.action);

    const removals = await Promise.allSettled(
      prepared.providerDeploymentIds.map((providerDeploymentId) =>
        this.deploymentProvider.remove(providerDeploymentId),
      ),
    );
    const failed = removals.some((result) => result.status === "rejected");
    const actions = new CustomerAppActionRepository(this.database);
    if (failed) {
      await actions.fail(prepared.action.id, "PROVIDER_CLEANUP_FAILED");
      throw new PocketCloudError({
        code: "INTERNAL_RETRYABLE",
        customerMessage: "The project is no longer active, but its old public link still needs cleanup.",
        retryable: true,
      });
    }
    return asResult(await actions.complete({
      id: prepared.action.id,
      appStatus: prepared.action.resultingAppStatus!,
      ...(prepared.action.recoverableUntil === null
        ? {}
        : { recoverableUntil: prepared.action.recoverableUntil }),
      providerCleanupStatus: "COMPLETED",
    }));
  }
}
