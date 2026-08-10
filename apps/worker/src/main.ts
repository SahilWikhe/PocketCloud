import { randomUUID } from "node:crypto";

import { VercelDeploymentProvider } from "@pocketcloud/deployment";
import { VercelSandboxExecutionProvider } from "@pocketcloud/execution";
import {
  createNeonDatabaseFromEnvironment,
  VercelBlobPrivateObjectStorage,
} from "@pocketcloud/platform";

import { createDeploymentWorker, type DeploymentWorkerLogger } from "./integration/deployment-worker";

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const logger: DeploymentWorkerLogger = {
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

const database = createNeonDatabaseFromEnvironment();
const storage = new VercelBlobPrivateObjectStorage({
  ...(process.env.BLOB_READ_WRITE_TOKEN === undefined
    ? {}
    : { token: process.env.BLOB_READ_WRITE_TOKEN }),
});
const deploymentProvider = new VercelDeploymentProvider({
  token: requiredEnvironmentValue("VERCEL_TOKEN"),
  projectName: requiredEnvironmentValue("VERCEL_PROJECT_NAME"),
  ...(process.env.VERCEL_PROJECT_ID === undefined
    ? {}
    : { projectId: process.env.VERCEL_PROJECT_ID }),
  ...(process.env.VERCEL_TEAM_ID === undefined ? {} : { teamId: process.env.VERCEL_TEAM_ID }),
});
const worker = createDeploymentWorker({
  database,
  storage,
  executionProvider: new VercelSandboxExecutionProvider(),
  deploymentProvider,
  workerId: process.env.POCKETCLOUD_WORKER_ID ?? `worker_${randomUUID()}`,
  logger,
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

try {
  while (!stopping) {
    try {
      const result = await worker.runOnce();
      if (result.status === "idle") {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    } catch (error) {
      logger.error("Worker loop failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
} finally {
  await database.close();
}
