import {
  type ClientUploadStorage,
  type PrivateObjectStorage,
  type TransactionalSqlExecutor,
} from "@pocketcloud/platform";
import { clerkPlugin } from "@clerk/fastify";
import Fastify, { type FastifyInstance } from "fastify";

import { resolveActorKey } from "./auth/actor";
import {
  CustomerContextService,
  type CustomerIdentityProvider,
} from "./auth/customer";
import { registerErrorHandler } from "./http/errors";
import { registerCustomerRoutes } from "./routes/customer/routes";
import { registerDeploymentRoutes } from "./routes/deployments/routes";
import { registerOperatorRoutes } from "./routes/operator/routes";
import { registerUploadRoutes } from "./routes/uploads/routes";
import {
  DeploymentService,
  type DeploymentDispatcher,
} from "./services/deployments/deployment-service";
import { OperationsService } from "./services/operations/operations-service";
import { DashboardService } from "./services/dashboard/dashboard-service";
import { CustomerLifecycleService } from "./services/lifecycle/customer-lifecycle-service";
import { UploadService } from "./services/uploads/upload-service";
import {
  SuspensionService,
  type DeploymentRemovalProvider,
} from "./services/suspension/suspension-service";

export interface BuildApiOptions {
  database: TransactionalSqlExecutor;
  storage: PrivateObjectStorage;
  clientUploadStorage?: ClientUploadStorage;
  actorHashSecret: string;
  deploymentDispatcher?: DeploymentDispatcher;
  customerIdentity?: CustomerIdentityProvider;
  clerk?: {
    secretKey: string;
    publishableKey: string;
  };
  logger?: boolean;
  customerLifecycle?: {
    deploymentProvider: DeploymentRemovalProvider;
  };
  operator?: {
    apiKey: string;
    deploymentProvider: DeploymentRemovalProvider;
  };
}

export function buildApi(options: BuildApiOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 64 * 1024,
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });
  if (options.clerk) {
    void app.register(clerkPlugin, {
      secretKey: options.clerk.secretKey,
      publishableKey: options.clerk.publishableKey,
    });
  }
  registerErrorHandler(app);

  const uploads = new UploadService({ database: options.database, storage: options.storage });
  const deployments = new DeploymentService({
    database: options.database,
    ...(options.deploymentDispatcher === undefined
      ? {}
      : { deploymentDispatcher: options.deploymentDispatcher }),
  });
  const customerContext = new CustomerContextService(options.database);
  const resolveAccess = async (request: Parameters<typeof resolveActorKey>[0]) => {
    if (!options.customerIdentity) {
      return { actorKey: resolveActorKey(request, options.actorHashSecret) };
    }
    const context = await customerContext.require(request, options.customerIdentity);
    return { actorKey: context.actorKey, workspaceId: context.workspace.id };
  };

  registerUploadRoutes(app, {
    service: uploads,
    resolveAccess,
    ...(options.clientUploadStorage === undefined
      ? {}
      : { clientUploadStorage: options.clientUploadStorage }),
  });
  registerDeploymentRoutes(app, {
    service: deployments,
    resolveAccess,
  });
  if (options.customerIdentity) {
    const lifecycle = options.customerLifecycle
      ? new CustomerLifecycleService({
          database: options.database,
          deploymentProvider: options.customerLifecycle.deploymentProvider,
          ...(options.deploymentDispatcher === undefined
            ? {}
            : { deploymentDispatcher: options.deploymentDispatcher }),
        })
      : undefined;
    registerCustomerRoutes(app, {
      context: customerContext,
      identity: options.customerIdentity,
      dashboard: new DashboardService(options.database, lifecycle !== undefined),
      ...(lifecycle === undefined ? {} : { lifecycle }),
    });
  }
  if (options.operator) {
    registerOperatorRoutes(app, {
      service: new SuspensionService({
        database: options.database,
        deploymentProvider: options.operator.deploymentProvider,
      }),
      operations: new OperationsService(options.database),
      operatorApiKey: options.operator.apiKey,
    });
  }
  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
