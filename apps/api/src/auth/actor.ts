import { createHmac } from "node:crypto";

import type { FastifyRequest } from "fastify";

export function resolveActorKey(request: FastifyRequest, secret: string): string {
  const clientActor = request.headers["x-pocketcloud-actor"];
  const value = typeof clientActor === "string" && clientActor.length <= 200
    ? `client:${clientActor}`
    : `ip:${request.ip}`;
  return createHmac("sha256", secret).update(value).digest("hex");
}
