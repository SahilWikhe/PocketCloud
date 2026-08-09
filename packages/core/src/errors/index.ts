import { z } from "zod";

export const pocketCloudErrorCodes = [
  "REQUEST_INVALID",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "CONFLICT",
  "UPLOAD_INVALID",
  "UPLOAD_LIMIT_EXCEEDED",
  "ARTIFACT_INCOMPLETE",
  "STORAGE_FAILED",
  "ARCHIVE_LIMIT_EXCEEDED",
  "ARCHIVE_UNSAFE_PATH",
  "FILE_TYPE_NOT_ALLOWED",
  "PROJECT_UNSUPPORTED",
  "ENTRYPOINT_MISSING",
  "NORMALIZATION_FAILED",
  "AI_BUDGET_EXCEEDED",
  "AI_PATCH_REJECTED",
  "VALIDATION_FAILED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_DEPLOYMENT_FAILED",
  "VERIFICATION_FAILED",
  "INTERNAL_RETRYABLE",
  "DEPLOYMENT_RATE_LIMITED",
  "DEPLOYMENT_SUSPENDED",
] as const;

export const pocketCloudErrorCodeSchema = z.enum(pocketCloudErrorCodes);
export type PocketCloudErrorCode = z.infer<typeof pocketCloudErrorCodeSchema>;

export const pocketCloudErrorShapeSchema = z.object({
  code: pocketCloudErrorCodeSchema,
  customerMessage: z.string().min(1),
  retryable: z.boolean(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
});

export type PocketCloudErrorShape = z.infer<typeof pocketCloudErrorShapeSchema>;

export class PocketCloudError extends Error {
  readonly code: PocketCloudErrorCode;
  readonly customerMessage: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;

  constructor(shape: PocketCloudErrorShape, options: ErrorOptions = {}) {
    super(shape.customerMessage, options);
    this.name = "PocketCloudError";
    this.code = shape.code;
    this.customerMessage = shape.customerMessage;
    this.retryable = shape.retryable;
    if (shape.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = shape.retryAfterSeconds;
    }
  }

  toShape(): PocketCloudErrorShape {
    return {
      code: this.code,
      customerMessage: this.customerMessage,
      retryable: this.retryable,
      ...(this.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: this.retryAfterSeconds }),
    };
  }
}
