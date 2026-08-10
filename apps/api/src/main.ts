import {
  createNeonDatabaseFromEnvironment,
  VercelBlobPrivateObjectStorage,
} from "@pocketcloud/platform";
import { VercelDeploymentProvider } from "@pocketcloud/deployment";

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
if (operatorApiKey !== undefined && (!process.env.VERCEL_TOKEN || !process.env.VERCEL_PROJECT_NAME)) {
  throw new Error(
    "VERCEL_TOKEN and VERCEL_PROJECT_NAME are required when operator controls are configured",
  );
}
const operatorDeploymentProvider =
  operatorApiKey === undefined
    ? undefined
    : new VercelDeploymentProvider({
        token: process.env.VERCEL_TOKEN!,
        projectName: process.env.VERCEL_PROJECT_NAME!,
        ...(process.env.VERCEL_PROJECT_ID === undefined
          ? {}
          : { projectId: process.env.VERCEL_PROJECT_ID }),
        ...(process.env.VERCEL_TEAM_ID === undefined
          ? {}
          : { teamId: process.env.VERCEL_TEAM_ID }),
      });
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
          deploymentProvider: operatorDeploymentProvider!,
        },
      }),
});

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
