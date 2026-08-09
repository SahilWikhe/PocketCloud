import { z } from "zod";

import { identifierSchema, isoDateTimeSchema } from "./common";

export const usageMetrics = [
  "upload_bytes",
  "sandbox_creation",
  "sandbox_active_milliseconds",
  "sandbox_memory_gb_milliseconds",
  "ai_input_tokens",
  "ai_output_tokens",
  "provider_deployment",
] as const;

export const usageReportV1Schema = z.object({
  schemaVersion: z.literal(1),
  deploymentId: identifierSchema,
  metric: z.enum(usageMetrics),
  quantity: z.number().nonnegative(),
  provider: z.string().min(1).optional(),
  occurredAt: isoDateTimeSchema,
});

export type UsageMetric = (typeof usageMetrics)[number];
export type UsageReportV1 = z.infer<typeof usageReportV1Schema>;

export interface UsageSink {
  record(report: UsageReportV1): Promise<void>;
}
