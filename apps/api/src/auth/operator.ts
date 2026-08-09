import { createHash, timingSafeEqual } from "node:crypto";

import { PocketCloudError } from "@pocketcloud/core";
import type { FastifyRequest } from "fastify";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function authorizeOperator(
  request: FastifyRequest,
  expectedApiKey: string,
): { operatorActor: string } {
  const supplied = request.headers["x-pocketcloud-operator-key"];
  const operatorActor = request.headers["x-pocketcloud-operator-id"];
  const valid =
    typeof supplied === "string" &&
    timingSafeEqual(digest(supplied), digest(expectedApiKey)) &&
    typeof operatorActor === "string" &&
    /^[a-zA-Z0-9._@-]{3,120}$/.test(operatorActor);
  if (!valid) {
    throw new PocketCloudError({
      code: "UNAUTHORIZED",
      customerMessage: "Operator authorization is required.",
      retryable: false,
    });
  }
  return { operatorActor };
}
