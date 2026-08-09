import {
  createNeonDatabaseFromEnvironment,
  VercelBlobPrivateObjectStorage,
} from "@pocketcloud/platform";

import { buildApi } from "./build-app";

const actorHashSecret = process.env.ACTOR_HASH_SECRET;
if (!actorHashSecret || actorHashSecret.length < 32) {
  throw new Error("ACTOR_HASH_SECRET must contain at least 32 characters");
}

const database = createNeonDatabaseFromEnvironment();
const storage = new VercelBlobPrivateObjectStorage();
const operatorApiKey = process.env.OPERATOR_API_KEY;
if (operatorApiKey !== undefined && operatorApiKey.length < 32) {
  throw new Error("OPERATOR_API_KEY must contain at least 32 characters when configured");
}
const app = buildApi({
  database,
  storage,
  clientUploadStorage: storage,
  actorHashSecret,
  logger: true,
  ...(operatorApiKey === undefined
    ? {}
    : {
        operator: {
          apiKey: operatorApiKey,
          deploymentProvider: {
            async remove() {
              throw new Error(
                "The deployment removal provider is not configured until PC-206 is integrated.",
              );
            },
          },
        },
      }),
});

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
