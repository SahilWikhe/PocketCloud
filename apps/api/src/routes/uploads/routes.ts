import {
  completedUploadV1Schema,
  createUploadIntentV1Schema,
  uploadIntentV1Schema,
} from "@pocketcloud/core";
import type { ClientUploadStorage } from "@pocketcloud/platform";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { resolveActorKey } from "../../auth/actor";
import type { UploadService } from "../../services/uploads/upload-service";

export interface UploadRoutesOptions {
  service: UploadService;
  clientUploadStorage?: ClientUploadStorage;
  actorHashSecret: string;
}

export function registerUploadRoutes(app: FastifyInstance, options: UploadRoutesOptions): void {
  app.post("/v1/uploads/intents", async (request, reply) => {
    const input = createUploadIntentV1Schema.parse(request.body);
    const actorKey = resolveActorKey(request, options.actorHashSecret);
    const result = uploadIntentV1Schema.parse(await options.service.createIntent(actorKey, input));
    return reply.status(201).send(result);
  });

  app.post("/v1/uploads/blob", async (request, reply) => {
    if (!options.clientUploadStorage) {
      return reply.status(503).send({
        error: {
          code: "STORAGE_FAILED",
          message: "Direct upload storage is not configured.",
          retryable: true,
          correlationId: request.id,
        },
      });
    }
    const actorKey = resolveActorKey(request, options.actorHashSecret);
    const result = await options.clientUploadStorage.handleClientUpload(
      request.raw,
      request.body,
      (authorizationRequest) =>
        options.service.authorizeClientUpload(actorKey, authorizationRequest),
    );
    return reply.send(result);
  });

  app.post("/v1/uploads/:uploadId/complete", async (request, reply) => {
    const parameters = z.object({ uploadId: z.string().min(1) }).parse(request.params);
    const actorKey = resolveActorKey(request, options.actorHashSecret);
    const result = completedUploadV1Schema.parse(
      await options.service.complete(actorKey, parameters.uploadId),
    );
    return reply.send(result);
  });
}
