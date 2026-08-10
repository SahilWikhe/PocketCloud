import type { IncomingMessage, ServerResponse } from "node:http";

import { buildProductionApi } from "@pocketcloud/api";

import { enqueueDeployment } from "./queue-client";

const appPromise = (async () => {
  const app = buildProductionApi({
    deploymentDispatcher: { enqueue: enqueueDeployment },
  });
  await app.ready();
  return app;
})();

function fastifyUrl(url: string | undefined): string {
  if (!url) return "/";
  return url.replace(/^\/api(?=\/v1(?:\/|\?|$))/, "");
}

export async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const app = await appPromise;
  request.url = fastifyUrl(request.url);
  await new Promise<void>((resolve, reject) => {
    response.once("finish", resolve);
    response.once("error", reject);
    app.server.emit("request", request, response);
  });
}
