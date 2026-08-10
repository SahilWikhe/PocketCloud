import { randomUUID } from "node:crypto";

import { VercelDeploymentProvider } from "@pocketcloud/deployment";
import { VercelSandboxExecutionProvider } from "@pocketcloud/execution";
import {
  createNeonDatabaseFromEnvironment,
  type PostgresDatabase,
  VercelBlobPrivateObjectStorage,
} from "@pocketcloud/platform";

import { pilotWorkerPolicyFromEnvironment } from "./config/pilot-policy";
import {
  createDeploymentWorker,
  type DeploymentWorker,
  type DeploymentWorkerLogger,
} from "./integration/deployment-worker";
import { ArtifactRetentionService } from "./operations/artifact-retention";

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const consoleDeploymentWorkerLogger: DeploymentWorkerLogger = {
  info(message, metadata) {
    console.info(message, metadata ?? {});
  },
  warn(message, metadata) {
    console.warn(message, metadata ?? {});
  },
  error(message, metadata) {
    console.error(message, metadata ?? {});
  },
};

function createStorage(environment: NodeJS.ProcessEnv): VercelBlobPrivateObjectStorage {
  return new VercelBlobPrivateObjectStorage({
    ...(environment.BLOB_READ_WRITE_TOKEN === undefined
      ? {}
      : { token: environment.BLOB_READ_WRITE_TOKEN }),
  });
}

export interface ProductionDeploymentWorkerRuntime {
  database: PostgresDatabase;
  storage: VercelBlobPrivateObjectStorage;
  worker: DeploymentWorker;
  close(): Promise<void>;
}

export function createProductionDeploymentWorkerRuntime(
  environment: NodeJS.ProcessEnv = process.env,
  logger: DeploymentWorkerLogger = consoleDeploymentWorkerLogger,
): ProductionDeploymentWorkerRuntime {
  const database = createNeonDatabaseFromEnvironment(environment);
  const storage = createStorage(environment);
  const policy = pilotWorkerPolicyFromEnvironment(environment);
  const worker = createDeploymentWorker({
    database,
    storage,
    executionProvider: new VercelSandboxExecutionProvider(),
    deploymentProvider: new VercelDeploymentProvider({
      token: requiredEnvironmentValue(environment, "VERCEL_TOKEN"),
      projectName: requiredEnvironmentValue(environment, "VERCEL_PROJECT_NAME"),
      ...(environment.VERCEL_PROJECT_ID === undefined
        ? {}
        : { projectId: environment.VERCEL_PROJECT_ID }),
      ...(environment.VERCEL_TEAM_ID === undefined
        ? {}
        : { teamId: environment.VERCEL_TEAM_ID }),
    }),
    workerId: environment.POCKETCLOUD_WORKER_ID ?? `vercel_${randomUUID()}`,
    globalConcurrency: policy.globalConcurrency,
    logger,
    ...(environment.VERCEL === "1"
      ? {
          workflowTimeoutMilliseconds: 50_000,
          providerWaitTimeoutMilliseconds: 35_000,
        }
      : {}),
  });
  return { database, storage, worker, close: () => database.close() };
}

export interface ProductionWorkerRuntime extends ProductionDeploymentWorkerRuntime {
  retention: ArtifactRetentionService;
}

export function createProductionWorkerRuntime(
  environment: NodeJS.ProcessEnv = process.env,
  logger: DeploymentWorkerLogger = consoleDeploymentWorkerLogger,
): ProductionWorkerRuntime {
  const runtime = createProductionDeploymentWorkerRuntime(environment, logger);
  return {
    ...runtime,
    retention: new ArtifactRetentionService({
      database: runtime.database,
      storage: runtime.storage,
      logger,
    }),
  };
}

export interface ProductionArtifactRetentionRuntime {
  database: PostgresDatabase;
  retention: ArtifactRetentionService;
  close(): Promise<void>;
}

export function createProductionArtifactRetentionRuntime(
  environment: NodeJS.ProcessEnv = process.env,
  logger: DeploymentWorkerLogger = consoleDeploymentWorkerLogger,
): ProductionArtifactRetentionRuntime {
  const database = createNeonDatabaseFromEnvironment(environment);
  const retention = new ArtifactRetentionService({
    database,
    storage: createStorage(environment),
    logger,
  });
  return { database, retention, close: () => database.close() };
}
