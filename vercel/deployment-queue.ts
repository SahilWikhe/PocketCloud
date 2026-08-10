import type { IncomingMessage, ServerResponse } from "node:http";

import {
  deploymentDispatchV1Schema,
  type DeploymentDispatchV1,
} from "@pocketcloud/core";
import { DeploymentJobRepository } from "@pocketcloud/platform";
import { createProductionDeploymentWorkerRuntime } from "@pocketcloud/worker";
import { QueueClient, type MessageMetadata } from "@vercel/queue";

const queue = new QueueClient();

class QueueRetryError extends Error {
  constructor(readonly delaySeconds: number) {
    super("Deployment processing should be retried");
    this.name = "QueueRetryError";
  }
}

function secondsUntil(timestamp: string): number {
  return Math.max(1, Math.ceil((Date.parse(timestamp) - Date.now()) / 1_000));
}

async function processDeploymentMessage(
  rawMessage: DeploymentDispatchV1,
  _metadata: MessageMetadata,
): Promise<void> {
  const message = deploymentDispatchV1Schema.parse(rawMessage);
  const runtime = createProductionDeploymentWorkerRuntime();
  try {
    const result = await runtime.worker.runDeployment(message.deploymentId);
    if (result.status === "retry_scheduled") {
      throw new QueueRetryError(result.delaySeconds);
    }
    if (result.status !== "idle") return;

    const job = await new DeploymentJobRepository(runtime.database).findByDeploymentId(
      message.deploymentId,
    );
    if (job?.status === "QUEUED") {
      throw new QueueRetryError(secondsUntil(job.availableAt));
    }
    if (
      job?.status === "CLAIMED" &&
      job.claimExpiresAt !== null &&
      Date.parse(job.claimExpiresAt) <= Date.now()
    ) {
      throw new QueueRetryError(1);
    }
  } finally {
    await runtime.close();
  }
}

const deploymentQueueHandler = queue.handleNodeCallback<DeploymentDispatchV1>(
  processDeploymentMessage,
  {
    visibilityTimeoutSeconds: 300,
    retry(error, metadata) {
      if (error instanceof QueueRetryError) {
        return { afterSeconds: Math.min(300, Math.max(1, error.delaySeconds)) };
      }
      return { afterSeconds: Math.min(300, 2 ** Math.min(metadata.deliveryCount, 8)) };
    },
  },
);

interface VercelRequest extends IncomingMessage {
  body?: unknown;
}

interface VercelResponse extends ServerResponse {
  status(code: number): {
    json(data: unknown): void;
    end(): void;
  };
}

export function handleDeploymentQueue(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  return deploymentQueueHandler(
    {
      method: request.method ?? "POST",
      headers: request.headers,
      body: request.body,
    },
    response,
  );
}
