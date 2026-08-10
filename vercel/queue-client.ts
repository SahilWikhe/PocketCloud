import { deploymentDispatchV1Schema } from "@pocketcloud/core";
import { QueueClient } from "@vercel/queue";

export const deploymentQueueTopic = "pocketcloud-deployments";

const queue = new QueueClient();

export async function enqueueDeployment(deploymentId: string): Promise<void> {
  const message = deploymentDispatchV1Schema.parse({ schemaVersion: 1, deploymentId });
  await queue.send(deploymentQueueTopic, message, {
    idempotencyKey: `deployment-${deploymentId}`,
    retentionSeconds: 7 * 24 * 60 * 60,
  });
}
