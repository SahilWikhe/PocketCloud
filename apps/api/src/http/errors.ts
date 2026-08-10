import {
  PocketCloudError,
  customerErrorResponseV1Schema,
  type PocketCloudErrorCode,
} from "@pocketcloud/core";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { presentCustomerError } from "../services/deployments/customer-presentation";

const statusByCode: Partial<Record<PocketCloudErrorCode, number>> = {
  REQUEST_INVALID: 400,
  UPLOAD_INVALID: 400,
  UPLOAD_LIMIT_EXCEEDED: 413,
  ARTIFACT_INCOMPLETE: 409,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  CONFLICT: 409,
  DEPLOYMENT_RATE_LIMITED: 429,
  DEPLOYMENT_SUSPENDED: 409,
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const pocketCloudError =
      error instanceof PocketCloudError
        ? error
        : error instanceof ZodError
          ? new PocketCloudError(
              {
                code: "REQUEST_INVALID",
                customerMessage: "The request contains invalid information.",
                retryable: false,
              },
              { cause: error },
            )
          : new PocketCloudError(
              {
                code: "INTERNAL_RETRYABLE",
                customerMessage: "PocketCloud could not complete that request. Please try again.",
                retryable: true,
              },
              { cause: error },
            );

    request.log.error(
      { error, correlationId: request.id, code: pocketCloudError.code },
      "Request failed",
    );
    if (pocketCloudError.retryAfterSeconds !== undefined) {
      void reply.header("retry-after", String(pocketCloudError.retryAfterSeconds));
    }
    const presentation = presentCustomerError(pocketCloudError.code, {
      retryable: pocketCloudError.retryable,
      ...(pocketCloudError.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: pocketCloudError.retryAfterSeconds }),
    });
    const body = customerErrorResponseV1Schema.parse({
      error: {
        code: presentation.code,
        message: presentation.message,
        guidance: presentation.guidance,
        retryable: presentation.retryable,
        ...(presentation.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: presentation.retryAfterSeconds }),
        correlationId: request.id,
      },
    });
    void reply.status(statusByCode[pocketCloudError.code] ?? 500).send(body);
  });
}
