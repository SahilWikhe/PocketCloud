import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createProductionArtifactRetentionRuntime } from "@pocketcloud/worker";

function authorizedCronRequest(request: IncomingMessage): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.authorization;
  if (!secret || secret.length < 32 || typeof authorization !== "string") return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export async function handleArtifactRetention(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }
  if (!authorizedCronRequest(request)) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }

  const runtime = createProductionArtifactRetentionRuntime();
  try {
    const result = await runtime.retention.runOnce();
    sendJson(response, result.failures.length === 0 ? 200 : 500, {
      expiredUploadIntents: result.expiredUploadIntents,
      deletedArtifacts: result.deletedArtifacts,
      failureCount: result.failures.length,
    });
  } finally {
    await runtime.close();
  }
}
