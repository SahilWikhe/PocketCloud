import {
  customerDashboardV1Schema,
  customerSessionV1Schema,
  type CustomerDashboardV1,
  type CustomerSessionV1,
} from "@pocketcloud/core";
import {
  AppRepository,
  DeploymentRepository,
  type TransactionalSqlExecutor,
} from "@pocketcloud/platform";

import type { CustomerContext } from "../../auth/customer";
import { presentCustomerError } from "../deployments/customer-presentation";

export class DashboardService {
  constructor(private readonly database: TransactionalSqlExecutor) {}

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
    const history = await new DeploymentRepository(this.database).listByWorkspace(
      context.workspace.id,
    );
    const appById = new Map(apps.map((app) => [app.id, app]));
    const latestByApp = new Map(latest.map((deployment) => [deployment.appId, deployment]));
    return customerDashboardV1Schema.parse({
      schemaVersion: 1,
      session: this.session(context),
      apps: apps.map((app) => {
        const deployment = latestByApp.get(app.id);
        return {
          appId: app.id,
          name: app.name,
          slug: app.slug,
          status: app.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
          activeVersionId: app.activeVersionId,
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
    });
  }
}
