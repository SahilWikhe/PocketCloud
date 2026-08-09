import { z } from "zod";

import { identifierSchema, isoDateTimeSchema } from "./common";

export const deploymentJobV1Schema = z.object({
  schemaVersion: z.literal(1),
  jobId: identifierSchema,
  deploymentId: identifierSchema,
  appId: identifierSchema,
  versionId: identifierSchema,
  originalArtifactId: identifierSchema,
  correlationId: identifierSchema,
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  requestedAt: isoDateTimeSchema,
}).refine((job) => job.attempt <= job.maxAttempts, {
  message: "attempt cannot exceed maxAttempts",
  path: ["attempt"],
});

export type DeploymentJobV1 = z.infer<typeof deploymentJobV1Schema>;
