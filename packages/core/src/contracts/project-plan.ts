import { z } from "zod";

import { normalizedRelativePathSchema } from "./common";

export const projectKindSchema = z.enum([
  "static",
  "buildable_frontend",
  "full_stack",
  "service",
]);

export const environmentRequirementSchema = z.object({
  name: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
  required: z.boolean(),
  public: z.boolean(),
  reason: z.string().min(1),
});

export const projectEvidenceSchema = z.object({
  code: z.string().min(1),
  path: normalizedRelativePathSchema.optional(),
  summary: z.string().min(1),
});

const commandSchema = z.array(z.string().min(1)).min(1).readonly().nullable();

export const projectPlanV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: projectKindSchema,
  projectRoot: z.union([z.literal("."), normalizedRelativePathSchema]),
  entrypoint: normalizedRelativePathSchema.nullable(),
  runtime: z.string().min(1).nullable(),
  framework: z.string().min(1).nullable(),
  installCommand: commandSchema,
  buildCommand: commandSchema,
  startCommand: commandSchema,
  outputDirectory: z.union([z.literal("."), normalizedRelativePathSchema]),
  requiredEnvironmentVariables: z.array(environmentRequirementSchema).readonly(),
  deploymentProvider: z.string().min(1),
  evidence: z.array(projectEvidenceSchema).readonly(),
});

export type ProjectKind = z.infer<typeof projectKindSchema>;
export type EnvironmentRequirement = z.infer<typeof environmentRequirementSchema>;
export type ProjectEvidence = z.infer<typeof projectEvidenceSchema>;
export type ProjectPlanV1 = z.infer<typeof projectPlanV1Schema>;

export function assertStaticMvpPlan(plan: ProjectPlanV1): void {
  const allowed =
    plan.kind === "static" &&
    plan.runtime === null &&
    plan.framework === null &&
    plan.installCommand === null &&
    plan.buildCommand === null &&
    plan.startCommand === null &&
    plan.requiredEnvironmentVariables.length === 0 &&
    plan.entrypoint !== null &&
    plan.entrypoint.split("/").at(-1) === "index.html";

  if (!allowed) {
    throw new Error("Project plan is outside the static MVP policy");
  }
}
