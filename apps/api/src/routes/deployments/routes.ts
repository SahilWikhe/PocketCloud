import {
  createDeploymentV1Schema,
  deploymentCreatedV1Schema,
  deploymentStatusV1Schema,
  PocketCloudError,
} from "@pocketcloud/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { CustomerAccess } from "../uploads/routes";
import type { DeploymentService } from "../../services/deployments/deployment-service";

export interface DeploymentRoutesOptions {
  service: DeploymentService;
  resolveAccess(request: FastifyRequest): Promise<CustomerAccess>;
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
    const { actorKey } = await options.resolveAccess(request);
    const result = deploymentCreatedV1Schema.parse(
      await options.service.create(actorKey, rawKey, input),
    );
    return reply.status(202).send(result);
  });

  app.get("/v1/deployments/:deploymentId", async (request, reply) => {
    const parameters = z.object({ deploymentId: z.string().min(1) }).parse(request.params);
    const { actorKey } = await options.resolveAccess(request);
    const result = deploymentStatusV1Schema.parse(
      await options.service.getStatus(actorKey, parameters.deploymentId),
    );
    return reply.send(result);
  });
}
