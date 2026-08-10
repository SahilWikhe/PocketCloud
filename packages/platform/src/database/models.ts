import type {
  ArtifactKind,
  DeploymentEventV1,
  DeploymentState,
  PocketCloudErrorCode,
  ProjectPlanV1,
  UsageMetric,
} from "@pocketcloud/core";

export type AppStatus = "ACTIVE" | "SUSPENDED" | "DELETED";
export type ArtifactStatus = "QUARANTINED" | "APPROVED" | "REJECTED" | "DELETED";
export type UploadIntentStatus = "PENDING" | "COMPLETED" | "EXPIRED" | "REJECTED";
export type JobStatus = "QUEUED" | "CLAIMED" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface AppRecord {
  id: string;
  actorKey: string;
  name: string;
  slug: string;
  status: AppStatus;
  activeVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRecord {
  id: string;
  kind: ArtifactKind;
  storageProvider: string;
  storageKey: string;
  sha256: string;
  compressedBytes: number;
  expandedBytes: number | null;
  fileCount: number | null;
  status: ArtifactStatus;
  expiresAt: string | null;
  createdAt: string;
}

export interface AppVersionRecord {
  id: string;
  appId: string;
  sequence: number;
  originalArtifactId: string | null;
  normalizedArtifactId: string | null;
  projectPlan: ProjectPlanV1 | null;
  platformCheckStatus: string;
  createdAt: string;
}

export interface UploadIntentRecord {
  id: string;
  actorKey: string;
  versionId: string;
  plannedArtifactId: string;
  storageKey: string;
  expectedSha256: string;
  expectedBytes: number;
  contentType: "application/zip";
  status: UploadIntentStatus;
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface DeploymentRecord {
  id: string;
  actorKey: string;
  appId: string;
  versionId: string;
  status: DeploymentState;
  provider: string;
  providerProjectId: string | null;
  providerDeploymentId: string | null;
  publicUrl: string | null;
  idempotencyKey: string;
  errorCode: PocketCloudErrorCode | null;
  errorSummary: string | null;
  errorRetryable: boolean | null;
  errorRetryAfterSeconds: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedDeploymentEvent extends Omit<DeploymentEventV1, "occurredAt"> {
  id: string;
  sequence: number;
  occurredAt: string;
}

export interface DeploymentJobRecord {
  id: string;
  deploymentId: string;
  status: JobStatus;
  attempt: number;
  maxAttempts: number;
  availableAt: string;
  claimedBy: string | null;
  claimExpiresAt: string | null;
  lastErrorCode: PocketCloudErrorCode | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsageEventRecord {
  id: string;
  actorKey: string;
  deploymentId: string | null;
  metric: UsageMetric | "deployment";
  quantity: number;
  provider: string | null;
  createdAt: string;
}

export function toIso(value: string | Date): string {
  return new Date(value).toISOString();
}

export function toOptionalIso(value: string | Date | null): string | null {
  return value === null ? null : toIso(value);
}
