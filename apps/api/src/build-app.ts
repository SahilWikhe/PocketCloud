import {
  type ClientUploadStorage,
  type PrivateObjectStorage,
  type TransactionalSqlExecutor,
} from "@pocketcloud/platform";
import Fastify, { type FastifyInstance } from "fastify";

import { registerErrorHandler } from "./http/errors";
import { registerDeploymentRoutes } from "./routes/deployments/routes";
import { registerOperatorRoutes } from "./routes/operator/routes";
import { registerUploadRoutes } from "./routes/uploads/routes";
import { DeploymentService } from "./services/deployments/deployment-service";
import { OperationsService } from "./services/operations/operations-service";
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
  logger?: boolean;
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
  registerErrorHandler(app);

  const uploads = new UploadService({ database: options.database, storage: options.storage });
  const deployments = new DeploymentService({ database: options.database });

  registerUploadRoutes(app, {
    service: uploads,
    actorHashSecret: options.actorHashSecret,
    ...(options.clientUploadStorage === undefined
      ? {}
      : { clientUploadStorage: options.clientUploadStorage }),
  });
  registerDeploymentRoutes(app, {
    service: deployments,
    actorHashSecret: options.actorHashSecret,
  });
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
