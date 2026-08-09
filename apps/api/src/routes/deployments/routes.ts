import {
  createDeploymentV1Schema,
  deploymentCreatedV1Schema,
  deploymentStatusV1Schema,
  PocketCloudError,
} from "@pocketcloud/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { resolveActorKey } from "../../auth/actor";
import type { DeploymentService } from "../../services/deployments/deployment-service";

export interface DeploymentRoutesOptions {
  service: DeploymentService;
  actorHashSecret: string;
}

export function registerDeploymentRoutes(
  app: FastifyInstance,
  options: DeploymentRoutesOptions,
): void {
  app.post("/v1/deployments", async (request, reply) => {
    const input = createDeploymentV1Schema.parse(request.body);
    const rawKey = request.headers["idempotency-key"];
    if (typeof rawKey !== "string") {
      throw new PocketCloudError({
        code: "REQUEST_INVALID",
        customerMessage: "An idempotency key is required.",
        retryable: false,
      });
    }
    const actorKey = resolveActorKey(request, options.actorHashSecret);
    const result = deploymentCreatedV1Schema.parse(
      await options.service.create(actorKey, rawKey, input),
    );
    return reply.status(202).send(result);
  });

  app.get("/v1/deployments/:deploymentId", async (request, reply) => {
    const parameters = z.object({ deploymentId: z.string().min(1) }).parse(request.params);
    const actorKey = resolveActorKey(request, options.actorHashSecret);
    const result = deploymentStatusV1Schema.parse(
      await options.service.getStatus(actorKey, parameters.deploymentId),
    );
    return reply.send(result);
  });
}
