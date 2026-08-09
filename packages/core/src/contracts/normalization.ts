import { z } from "zod";

import {
  identifierSchema,
  normalizedRelativePathSchema,
  sha256Schema,
} from "./common";

export const normalizationChangeV1Schema = z.object({
  schemaVersion: z.literal(1),
  changeId: identifierSchema,
  source: z.enum(["deterministic", "ai"]),
  ruleCode: z.string().min(1),
  operation: z.enum(["create", "modify", "move", "delete"]),
  path: normalizedRelativePathSchema,
  previousPath: normalizedRelativePathSchema.optional(),
  beforeSha256: sha256Schema.optional(),
  afterSha256: sha256Schema.optional(),
  summary: z.string().min(1),
  requiresCustomerAttention: z.boolean(),
});

export type NormalizationChangeV1 = z.infer<typeof normalizationChangeV1Schema>;
