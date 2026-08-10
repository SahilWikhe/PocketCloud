import { pilotWorkerPolicyFromEnvironment } from "./config/pilot-policy";
import {
  consoleDeploymentWorkerLogger as logger,
  createProductionWorkerRuntime,
} from "./runtime";

const pilotPolicy = pilotWorkerPolicyFromEnvironment(process.env);
const runtime = createProductionWorkerRuntime(process.env, logger);
const worker = runtime.worker;
const retention = runtime.retention;

let stopping = false;
let nextRetentionSweepAt = 0;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

try {
  while (!stopping) {
    try {
      if (Date.now() >= nextRetentionSweepAt) {
        nextRetentionSweepAt = Date.now() + pilotPolicy.retentionSweepIntervalMilliseconds;
        const result = await retention.runOnce();
        if (result.expiredUploadIntents > 0 || result.deletedArtifacts > 0) {
          logger.info("Expired private artifacts cleaned", {
            expiredUploadIntents: result.expiredUploadIntents,
            deletedArtifacts: result.deletedArtifacts,
          });
        }
        if (result.failures.length > 0) {
          logger.warn("Artifact retention sweep needs operator attention", {
            failureCount: result.failures.length,
          });
        }
      }
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
  await runtime.close();
}
