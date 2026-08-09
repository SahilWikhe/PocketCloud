# Shared Contracts Between Workstreams

## Purpose

The control plane and execution plane must be able to evolve independently. These contracts are the seam between them.

This document describes the intended semantics. `PC-002` turns them into versioned TypeScript types or runtime schemas. Once merged, code is authoritative and this document should change in the same PR as any intentional interface change.

## Contract rules

- Contracts contain PocketCloud concepts, not vendor SDK objects.
- Identifiers are opaque strings.
- Dates crossing process boundaries use ISO 8601 UTC strings.
- Paths are normalized forward-slash relative paths and never begin with `/`.
- Serialized contracts contain a `schemaVersion` when persisted or sent across a queue.
- New optional fields are preferred over breaking renames.
- Secrets, signed URLs, raw source code, and provider credentials are never included.
- Internal exception objects do not cross the boundary.

## Deployment states

```text
CREATED
UPLOADING
QUARANTINED
QUEUED
CLAIMED
SANDBOX_STARTING
ANALYZING
NORMALIZING
VALIDATING
READY_TO_DEPLOY
DEPLOYING
VERIFYING
READY
FAILED
CANCELLED
SUSPENDED
```

Terminal states:

```text
READY
FAILED
CANCELLED
SUSPENDED
```

The shared state-machine implementation validates transitions. No app defines a separate status enum.

## `DeploymentJob`

Created by the control plane and consumed by the worker.

```ts
interface DeploymentJobV1 {
  schemaVersion: 1;
  jobId: string;
  deploymentId: string;
  appId: string;
  versionId: string;
  originalArtifactId: string;
  correlationId: string;
  attempt: number;
  maxAttempts: number;
  requestedAt: string;
}
```

Rules:

- `originalArtifactId` is resolved through the artifact repository and storage adapter.
- The job does not contain a permanent storage URL.
- `attempt` is set by job delivery and cannot exceed `maxAttempts`.
- Processing the same `jobId` more than once must not create duplicate provider deployments.

## `ProjectPlan`

Produced by the analyzer and approved by deterministic policy.

```ts
type ProjectKind =
  | "static"
  | "buildable_frontend"
  | "full_stack"
  | "service";

interface ProjectPlanV1 {
  schemaVersion: 1;
  kind: ProjectKind;
  projectRoot: string;
  entrypoint: string | null;
  runtime: string | null;
  framework: string | null;
  installCommand: readonly string[] | null;
  buildCommand: readonly string[] | null;
  startCommand: readonly string[] | null;
  outputDirectory: string;
  requiredEnvironmentVariables: readonly EnvironmentRequirement[];
  deploymentProvider: string;
  evidence: readonly ProjectEvidence[];
}

interface EnvironmentRequirement {
  name: string;
  required: boolean;
  public: boolean;
  reason: string;
}

interface ProjectEvidence {
  code: string;
  path?: string;
  summary: string;
}
```

MVP policy:

- Only `kind: "static"` may proceed.
- All command fields must be `null`.
- `runtime` and `framework` must be `null`.
- `requiredEnvironmentVariables` must be empty.
- `entrypoint` must resolve to `index.html` in normalized output.

Future command arrays are produced or approved by deterministic policy. They are never arbitrary shell strings.

## `ArtifactManifest`

Describes immutable bytes without exposing provider-specific storage details.

```ts
type ArtifactKind = "original" | "normalized" | "build_output" | "diagnostic";

interface ArtifactManifestV1 {
  schemaVersion: 1;
  artifactId: string;
  kind: ArtifactKind;
  sha256: string;
  totalBytes: number;
  fileCount: number;
  files: readonly ArtifactFile[];
  createdAt: string;
}

interface ArtifactFile {
  path: string;
  sha256: string;
  size: number;
  mediaType: string | null;
}
```

Rules:

- Files are ordered by normalized path before hashing or serialization.
- Paths are unique after normalization.
- Manifest totals must equal file entries.
- Storage provider, bucket, and signed URLs stay in `packages/platform`.
- Deployment provider receives a file-source abstraction plus this manifest.

## `NormalizationChange`

Produced by deterministic or AI normalization and displayed later to the customer.

```ts
type ChangeSource = "deterministic" | "ai";
type ChangeOperation = "create" | "modify" | "move" | "delete";

interface NormalizationChangeV1 {
  schemaVersion: 1;
  changeId: string;
  source: ChangeSource;
  ruleCode: string;
  operation: ChangeOperation;
  path: string;
  previousPath?: string;
  beforeSha256?: string;
  afterSha256?: string;
  summary: string;
  requiresCustomerAttention: boolean;
}
```

Rules:

- `summary` is safe to show to the customer.
- File contents are not stored in the change record.
- AI changes use the same shape as deterministic changes.
- The worker sends changes to an event or result sink; the normalizer does not write to PostgreSQL directly.

## `DeploymentEvent`

Created throughout processing and persisted by the control plane or platform adapter.

```ts
type DeploymentEventType = "state" | "progress" | "warning" | "error";

interface DeploymentEventV1 {
  schemaVersion: 1;
  deploymentId: string;
  type: DeploymentEventType;
  code: string;
  customerMessage: string;
  internalMetadata?: Record<string, unknown>;
  occurredAt: string;
}
```

Rules:

- Persistence assigns the final per-deployment sequence.
- `customerMessage` contains no provider internals, paths outside normalized output, source code, or credentials.
- `internalMetadata` is restricted from customer API responses.
- Events are append-only.

## `UsageReport`

The worker reports expensive operations without importing database code.

```ts
type UsageMetric =
  | "upload_bytes"
  | "sandbox_creation"
  | "sandbox_active_milliseconds"
  | "sandbox_memory_gb_milliseconds"
  | "ai_input_tokens"
  | "ai_output_tokens"
  | "provider_deployment";

interface UsageReportV1 {
  schemaVersion: 1;
  deploymentId: string;
  metric: UsageMetric;
  quantity: number;
  provider?: string;
  occurredAt: string;
}
```

Usage is append-only. Future billing derives from these events rather than mutable counters alone.

## `ExecutionProvider`

Owned by the execution plane and consumed by the worker.

```ts
interface ExecutionProvider {
  create(options: ExecutionOptions): Promise<ExecutionEnvironment>;
  writeFiles(environmentId: string, files: readonly InputFile[]): Promise<void>;
  run(environmentId: string, command: Command): Promise<CommandResult>;
  readFiles(environmentId: string, paths: readonly string[]): Promise<readonly OutputFile[]>;
  stop(environmentId: string): Promise<void>;
}
```

Important semantics:

- `stop` is idempotent.
- `Command` is an executable plus argument array, not a shell string.
- Provider implementation owns Vercel Sandbox SDK types.
- Provider returns sanitized results and bounded output.
- The MVP may use `run` only for approved PocketCloud utilities, not uploaded project commands.

## `DeploymentProvider`

Owned by the execution plane and used by worker orchestration. Control-plane operator actions may call it through an application service, not through SDK types.

```ts
interface DeploymentProvider {
  deploy(input: DeployableArtifact): Promise<ProviderDeployment>;
  getStatus(providerDeploymentId: string): Promise<ProviderDeploymentStatus>;
  getLogs(providerDeploymentId: string): Promise<readonly ProviderLog[]>;
  cancel(providerDeploymentId: string): Promise<void>;
  remove(providerDeploymentId: string): Promise<void>;
}

interface ProviderDeployment {
  provider: string;
  providerDeploymentId: string;
  providerProjectId?: string;
  candidateUrl?: string;
}
```

Rules:

- `candidateUrl` is not customer-visible until verification succeeds.
- Provider status maps into a small internal status type.
- `cancel` and `remove` are idempotent.
- Vercel-specific request payloads and response objects remain inside the adapter.

## `PocketCloudError`

Stable error codes are shared; raw exceptions remain local.

```ts
interface PocketCloudErrorShape {
  code: PocketCloudErrorCode;
  customerMessage: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}
```

Initial codes:

```text
UPLOAD_INVALID
UPLOAD_LIMIT_EXCEEDED
ARCHIVE_LIMIT_EXCEEDED
ARCHIVE_UNSAFE_PATH
FILE_TYPE_NOT_ALLOWED
PROJECT_UNSUPPORTED
ENTRYPOINT_MISSING
NORMALIZATION_FAILED
AI_BUDGET_EXCEEDED
AI_PATCH_REJECTED
VALIDATION_FAILED
PROVIDER_RATE_LIMITED
PROVIDER_DEPLOYMENT_FAILED
VERIFICATION_FAILED
INTERNAL_RETRYABLE
DEPLOYMENT_RATE_LIMITED
DEPLOYMENT_SUSPENDED
```

Rules:

- Provider errors map into these codes at the adapter boundary.
- Internal causes may be logged using a correlation ID.
- Customer messages do not expose stacks, credentials, raw logs, or untrusted file contents.

## Event and result sinks

Execution packages should report behavior through injected interfaces:

```ts
interface DeploymentEventSink {
  emit(event: DeploymentEventV1): Promise<void>;
}

interface UsageSink {
  record(report: UsageReportV1): Promise<void>;
}

interface ArtifactStore {
  getManifest(artifactId: string): Promise<ArtifactManifestV1>;
  readFiles(artifactId: string): AsyncIterable<ArtifactFileChunk>;
  writeArtifact(input: NewArtifactInput): Promise<ArtifactManifestV1>;
}
```

This prevents worker packages from depending on API routes, database tables, or storage-vendor SDKs.

## Control-plane browser contracts

Builder A also exposes versioned runtime schemas for the dashboard/API boundary in
`packages/core/src/contracts/control-plane.ts`:

```text
CreateUploadIntentV1
UploadIntentV1
CompletedUploadV1
CreateDeploymentV1
DeploymentCreatedV1
DeploymentStatusV1
CustomerErrorResponseV1
```

The upload target describes a private direct-client strategy. Its short-lived authorization
details are returned only to the requesting browser and are never persisted as durable artifact
identity. Database and queue contracts continue to use opaque artifact IDs and internal storage
keys, never signed URLs.

`DeploymentStatusV1` contains customer-safe events, normalization summaries, a public URL only
after `READY`, and stable error information. It deliberately excludes provider logs, Sandbox
details, internal event metadata, credentials, and raw source.

## Interface-change process

When a story needs to change a shared contract:

1. Add an `Interface change` section to the PR before implementation is complete.
2. Explain the current limitation and exact proposed shape.
3. List all consumers affected.
4. Update contract tests, TypeScript contract, this document, and callers in one merge-safe sequence.
5. Obtain review from the other builder.
6. Merge the contract change before dependent lane PRs.

If both lanes need incompatible changes, stop and make the product decision explicitly rather than creating parallel contract versions accidentally.
