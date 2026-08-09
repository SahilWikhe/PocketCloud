import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authorizeOperator } from "../../auth/operator";
import type { SuspensionService } from "../../services/suspension/suspension-service";

const parametersSchema = z.object({ appId: z.string().min(1) });
const actionBodySchema = z.object({ reason: z.string().trim().min(3).max(1000) });

export interface OperatorRoutesOptions {
  service: SuspensionService;
  operatorApiKey: string;
}

export function registerOperatorRoutes(
  app: FastifyInstance,
  options: OperatorRoutesOptions,
): void {
  app.post("/v1/operator/apps/:appId/suspend", async (request, reply) => {
    const parameters = parametersSchema.parse(request.params);
    const body = actionBodySchema.parse(request.body);
    const operator = authorizeOperator(request, options.operatorApiKey);
    return reply.send(
      await options.service.suspend({
        appId: parameters.appId,
        operatorActor: operator.operatorActor,
        reason: body.reason,
      }),
    );
  });

  app.post("/v1/operator/apps/:appId/reenable", async (request, reply) => {
    const parameters = parametersSchema.parse(request.params);
    const body = actionBodySchema.parse(request.body);
    const operator = authorizeOperator(request, options.operatorApiKey);
    return reply.send(
      await options.service.reenable({
        appId: parameters.appId,
        operatorActor: operator.operatorActor,
        reason: body.reason,
      }),
    );
  });
}
