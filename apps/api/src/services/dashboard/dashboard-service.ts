import {
  customerDashboardV1Schema,
  customerSessionV1Schema,
  type CustomerDashboardV1,
  type CustomerSessionV1,
} from "@pocketcloud/core";
import {
  AppRepository,
  CustomerAppActionRepository,
  DeploymentRepository,
  type TransactionalSqlExecutor,
} from "@pocketcloud/platform";

import type { CustomerContext } from "../../auth/customer";
import { presentCustomerError } from "../deployments/customer-presentation";

export class DashboardService {
  constructor(
    private readonly database: TransactionalSqlExecutor,
    private readonly lifecycleEnabled = false,
  ) {}

  session(context: CustomerContext): CustomerSessionV1 {
    return customerSessionV1Schema.parse({
      schemaVersion: 1,
      user: {
        userId: context.user.id,
        primaryEmail: context.user.primaryEmail,
        displayName: context.user.displayName,
      },
      workspace: {
        workspaceId: context.workspace.id,
        name: context.workspace.name,
        slug: context.workspace.slug,
        role: context.workspace.role,
        planCode: context.workspace.planCode,
      },
    });
  }

  async get(context: CustomerContext): Promise<CustomerDashboardV1> {
    const apps = await new AppRepository(this.database).listByWorkspace(context.workspace.id);
    const latest = await new DeploymentRepository(this.database).listLatestForApps(
      apps.map((app) => app.id),
    );
    const latestReady = await new DeploymentRepository(this.database).listLatestReadyForApps(
      apps.map((app) => app.id),
    );
    const history = await new DeploymentRepository(this.database).listByWorkspace(
      context.workspace.id,
    );
    const actions = await new CustomerAppActionRepository(this.database).listByWorkspace(
      context.workspace.id,
    );
    const canManage = this.lifecycleEnabled && ["OWNER", "ADMIN"].includes(context.workspace.role);
    const appById = new Map(apps.map((app) => [app.id, app]));
    const latestByApp = new Map(latest.map((deployment) => [deployment.appId, deployment]));
    const liveByApp = new Map(latestReady.map((deployment) => [deployment.appId, deployment]));
    return customerDashboardV1Schema.parse({
      schemaVersion: 1,
      session: this.session(context),
      apps: apps.map((app) => {
        const deployment = latestByApp.get(app.id);
        return {
          appId: app.id,
          name: app.name,
          slug: app.slug,
          status: app.status,
          suspensionSource: app.suspensionSource,
          recoverableUntil: app.recoverableUntil,
          availableActions: {
            redeploy: canManage && app.status === "ACTIVE" && app.activeVersionId !== null,
            suspend: canManage && app.status === "ACTIVE",
            restore:
              canManage &&
              app.suspensionSource !== "OPERATOR" &&
              (app.status === "SUSPENDED" ||
                (app.status === "DELETED" &&
                  app.recoverableUntil !== null &&
                  new Date(app.recoverableUntil) > new Date())),
            delete:
              canManage && app.status !== "DELETED" && app.suspensionSource !== "OPERATOR",
          },
          activeVersionId: app.activeVersionId,
          liveUrl: app.status === "ACTIVE" ? liveByApp.get(app.id)?.publicUrl ?? null : null,
          latestDeployment: deployment
            ? {
                deploymentId: deployment.id,
                versionId: deployment.versionId,
                status: deployment.status,
                publicUrl: deployment.status === "READY" ? deployment.publicUrl : null,
                createdAt: deployment.createdAt,
                updatedAt: deployment.updatedAt,
              }
            : null,
          createdAt: app.createdAt,
          updatedAt: app.updatedAt,
        };
      }),
      deployments: history.map((deployment) => ({
        deploymentId: deployment.id,
        appId: deployment.appId,
        appName: appById.get(deployment.appId)?.name ?? "Deleted app",
        versionId: deployment.versionId,
        status: deployment.status,
        publicUrl: deployment.status === "READY" ? deployment.publicUrl : null,
        errorMessage: deployment.errorCode
          ? presentCustomerError(deployment.errorCode, {
              ...(deployment.errorRetryable === null
                ? {}
                : { retryable: deployment.errorRetryable }),
              ...(deployment.errorRetryAfterSeconds === null
                ? {}
                : { retryAfterSeconds: deployment.errorRetryAfterSeconds }),
            }).message
          : null,
        createdAt: deployment.createdAt,
        updatedAt: deployment.updatedAt,
      })),
      actions: actions.map((action) => ({
        actionId: action.id,
        appId: action.appId,
        action: action.action,
        status: action.status,
        appStatus: action.resultingAppStatus,
        deploymentId: action.deploymentId,
        recoverableUntil: action.recoverableUntil,
        createdAt: action.createdAt,
        completedAt: action.completedAt,
      })),
    });
  }
}
