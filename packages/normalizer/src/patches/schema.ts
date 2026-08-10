import { normalizedRelativePathSchema } from "@pocketcloud/core";
import { z } from "zod";

export const maximumAiPatchOperations = 20;

export const aiPatchOperationSchema = z.object({
  operation: z.enum(["create", "replace", "delete"]),
  path: normalizedRelativePathSchema,
  content: z.string().optional(),
}).strict().superRefine((operation, context) => {
  if (operation.operation === "delete" && operation.content !== undefined) {
    context.addIssue({ code: "custom", path: ["content"], message: "Delete operations cannot contain content" });
  }
  if (operation.operation !== "delete" && operation.content === undefined) {
    context.addIssue({ code: "custom", path: ["content"], message: "Create and replace operations require content" });
  }
});

export const aiPatchResponseSchema = z.object({
  schemaVersion: z.literal(1),
  patches: z.array(aiPatchOperationSchema).max(maximumAiPatchOperations),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export type AiPatchResponse = z.infer<typeof aiPatchResponseSchema>;
