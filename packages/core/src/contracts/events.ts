import { z } from "zod";

import { identifierSchema, isoDateTimeSchema } from "./common";

export const deploymentEventV1Schema = z.object({
  schemaVersion: z.literal(1),
  deploymentId: identifierSchema,
  type: z.enum(["state", "progress", "warning", "error"]),
  code: z.string().min(1),
  customerMessage: z.string().min(1),
  internalMetadata: z.record(z.string(), z.unknown()).optional(),
  occurredAt: isoDateTimeSchema,
});

export type DeploymentEventV1 = z.infer<typeof deploymentEventV1Schema>;

export interface DeploymentEventSink {
  emit(event: DeploymentEventV1): Promise<void>;
}
