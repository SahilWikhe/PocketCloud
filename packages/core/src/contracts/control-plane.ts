import { z } from "zod";

import { deploymentStateSchema } from "../domain/deployment";
import { pocketCloudErrorCodeSchema } from "../errors/index";
import { identifierSchema, isoDateTimeSchema, normalizedRelativePathSchema, sha256Schema } from "./common";
import { normalizationChangeV1Schema } from "./normalization";

export const maximumMvpUploadBytes = 10 * 1024 * 1024;

export const createUploadIntentV1Schema = z.object({
  schemaVersion: z.literal(1),
  appId: identifierSchema.optional(),
  appName: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1).max(255).refine(
    (name) => name.toLowerCase().endsWith(".zip"),
    "Only ZIP uploads are supported",
  ),
  size: z.number().int().positive().max(maximumMvpUploadBytes),
  sha256: sha256Schema,
});

export const uploadTargetV1Schema = z.object({
  strategy: z.literal("direct_client"),
  provider: z.literal("vercel_blob"),
  pathname: normalizedRelativePathSchema,
  authorizationUrl: z.string().min(1),
  access: z.literal("private"),
  contentType: z.literal("application/zip"),
  maximumSizeInBytes: z.number().int().positive(),
  expiresAt: isoDateTimeSchema,
});

export const uploadIntentV1Schema = z.object({
  schemaVersion: z.literal(1),
  uploadId: identifierSchema,
  appId: identifierSchema,
  versionId: identifierSchema,
  plannedArtifactId: identifierSchema,
  upload: uploadTargetV1Schema,
});

export const completedUploadV1Schema = z.object({
  schemaVersion: z.literal(1),
  uploadId: identifierSchema,
  appId: identifierSchema,
  versionId: identifierSchema,
  artifactId: identifierSchema,
  status: z.literal("QUARANTINED"),
});

export const createDeploymentV1Schema = z.object({
  schemaVersion: z.literal(1),
  versionId: identifierSchema,
});

export const deploymentCreatedV1Schema = z.object({
  schemaVersion: z.literal(1),
  deploymentId: identifierSchema,
  status: deploymentStateSchema,
});

export const customerDeploymentEventV1Schema = z.object({
  sequence: z.number().int().positive(),
  type: z.enum(["state", "progress", "warning", "error"]),
  code: z.string().min(1),
  customerMessage: z.string().min(1),
  occurredAt: isoDateTimeSchema,
});

export const deploymentStatusV1Schema = z.object({
  schemaVersion: z.literal(1),
  deploymentId: identifierSchema,
  appId: identifierSchema,
  versionId: identifierSchema,
  status: deploymentStateSchema,
  publicUrl: z.string().url().nullable(),
  error: z.object({
    code: pocketCloudErrorCodeSchema,
    message: z.string().min(1),
    guidance: z.string().min(1).optional(),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().nonnegative().optional(),
  }).nullable(),
  events: z.array(customerDeploymentEventV1Schema).readonly(),
  changes: z.array(normalizationChangeV1Schema).readonly(),
});

export const customerErrorResponseV1Schema = z.object({
  error: z.object({
    code: pocketCloudErrorCodeSchema,
    message: z.string().min(1),
    guidance: z.string().min(1).optional(),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().nonnegative().optional(),
    correlationId: identifierSchema,
  }),
});

export type CreateUploadIntentV1 = z.infer<typeof createUploadIntentV1Schema>;
export type UploadIntentV1 = z.infer<typeof uploadIntentV1Schema>;
export type CompletedUploadV1 = z.infer<typeof completedUploadV1Schema>;
export type CreateDeploymentV1 = z.infer<typeof createDeploymentV1Schema>;
export type DeploymentCreatedV1 = z.infer<typeof deploymentCreatedV1Schema>;
export type DeploymentStatusV1 = z.infer<typeof deploymentStatusV1Schema>;
export type CustomerErrorResponseV1 = z.infer<typeof customerErrorResponseV1Schema>;
