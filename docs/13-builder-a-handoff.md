# Builder A Control-Plane Handoff

## Scope delivered

This implementation covers Builder A stories `PC-001`, `PC-002`, and `PC-101` through
`PC-106` on one user-authorized branch. Story boundaries remain visible in the code layout and
commit history even though the delivery uses one pull request.

## What now works

- A pnpm TypeScript monorepo with independently runnable web, API, and worker applications.
- Versioned Zod/TypeScript contracts, stable errors, and an enforced deployment state machine.
- PostgreSQL migrations and repositories for apps, versions, immutable artifacts, artifact
  files, uploads, deployments, ordered events, jobs, changes, usage, quotas, and operator audit.
- Private Vercel Blob direct-client upload authorization with exact path, content type, size,
  expiration, overwrite prevention, and server-side SHA-256 verification.
- Idempotent deployment creation and reconnectable customer status polling.
- Transactional hourly, daily, concurrent, and upload-size controls.
- Atomic job claims with leases, heartbeats, retry budgets, global concurrency, and one active
  claim per actor.
- A customer dashboard for ZIP selection, upload progress, deployment progress, safe errors,
  change summaries, and the verified public link.
- Constant-time operator-key authorization, app suspension, queued-job cancellation, provider
  removal through the shared interface, audit history, and explicit re-enabling.

## Builder B may depend on

```text
@pocketcloud/core
  DeploymentJobV1 and deploymentJobV1Schema
  ProjectPlanV1
  ArtifactManifestV1
  NormalizationChangeV1
  DeploymentEventV1 and DeploymentEventSink
  UsageReportV1 and UsageSink
  ExecutionProvider
  DeploymentProvider
  ArtifactStore
  PocketCloudError codes
  deployment state-machine helpers

@pocketcloud/platform
  PostgresDeploymentQueue
  PlatformArtifactStore
```

Builder B should not import API routes, API services, web files, database tables, Vercel Blob
SDK types, or PostgreSQL repository internals. Claim a job through `PostgresDeploymentQueue` and
resolve its `originalArtifactId` through `PlatformArtifactStore`.

## Interface change

`PC-002` adds the browser/control-plane schemas documented in `docs/11-shared-contracts.md`.
They do not change Builder B's worker payloads. Builder B should review the provider interfaces,
`DeploymentJobV1`, `ArtifactStore`, event sink, and usage sink before the branch is merged.

## PC-106 dependency note

Suspension is complete through the provider boundary and is tested with a fake provider. The API
entry point intentionally cannot construct Builder B's future Vercel deployment adapter. When
`PC-206` lands, inject its `remove(providerDeploymentId)` implementation into `buildApi` and
replace the temporary unavailable provider in `apps/api/src/main.ts`.

Without `PC-206`, database suspension, job cancellation, public-URL removal from customer API
responses, and audit recording work, but removal of an already-published Vercel deployment will
return an operator-visible cleanup failure. This is fail-closed for future PocketCloud actions
and explicit about the remaining external cleanup.

## Security impact

- Raw uploads remain private and immutable; browser-provided hashes are verified from stored bytes.
- Prototype actor identifiers are HMAC-hashed before persistence.
- Customer APIs omit internal event metadata and provider details.
- Operator credentials are compared in constant time and never stored.
- The UI and API say platform checks, never virus-free or malware-free.
- Antivirus, reputation, dependency, phishing, and behavioral scanners remain the documented
  third-party TODOs.

## Cost impact

The control plane introduces Neon queries and private Blob operations. No Sandbox, AI, or Vercel
deployment call occurs until Builder B's worker is integrated. Default durable quotas allow five
deployments per hour, twenty per day, one active deployment per actor, and three global worker
claims.

## Verification

Run:

```text
pnpm install
pnpm check
pnpm build
```

Database and API tests use isolated PGlite instances. Vercel Blob and Neon production credentials
are not required for the automated suite.

## PC-301 integration addendum

```text
Story: PC-301
Lane: Integration; Builder A author, Builder B reviewer
Branch: agent/pc-301-end-to-end-flow
Tracked issue: #12
Dependencies: PC-102 through PC-105 and PC-208 merged
```

### Outcome

The production worker now claims `DeploymentJobV1` from `PostgresDeploymentQueue`, heartbeats its
lease, runs the public `WorkerPipeline`, completes or reschedules the durable job, and maps terminal
failures without importing API routes or web code. PostgreSQL-backed adapters persist worker
checkpoints, deployment state, customer/internal events, usage, project plans, normalized artifact
references, normalization changes, provider references, verified URLs, and active-version
promotion.

The API production entry point now injects `VercelDeploymentProvider.remove` into operator
suspension. The worker production entry point composes private Vercel Blob storage,
`VercelSandboxExecutionProvider`, `VercelDeploymentProvider`, the PostgreSQL queue, and the durable
sinks in the trusted process. Provider and storage credentials remain host-only and are never part
of `ExecutionOptions`, Sandbox environment variables, job payloads, artifacts, events, or
checkpoints.

### Files owned and changed

```text
apps/api/src/main.ts
apps/api/src/pc-301.integration.test.ts
apps/worker/src/main.ts
apps/worker/src/integration/**
packages/platform/migrations/0003_worker_integration.sql
packages/platform/src/database/**
packages/platform/src/queue/**
.env.example
README.md
package manifests and pnpm-lock.yaml
```

### Interface change

No shared serialized core contract, deployment state, error code, event shape, usage shape, or job
payload changed. `WorkerCheckpoint` gains the additive optional `projectPlan: ProjectPlanV1` field
so the integration adapter can persist the analyzer result already required by the data model.
Builder B should review this worker/platform seam.

### Verification coverage

The `PC-301` integration test uses the public API, worker, platform, core, execution-provider, and
deployment-provider interfaces. It proves:

- A valid static ZIP moves from upload intent and immutable quarantine through one durable job to
  verified `READY`.
- Repeating the deployment request before and after processing returns the same deployment and
  creates one provider deployment.
- Closing and rebuilding the API process does not affect processing or the reconnected status.
- Deployment, version, app, job, artifact, event, usage, project-plan, provider-ID, and public-URL
  records agree.
- The Sandbox receives only the original archive and normalized output, never the trusted provider
  credential, and no uploaded command runs for the static fixture.

Automated checks use PGlite, in-memory private storage, and fake execution/deployment providers.
They do not require credentials and do not create billable resources.

Final verification:

```text
pnpm check                                      # 103 passed; 2 opt-in Vercel tests skipped
node --test tests/sample-apps/catalog.test.mjs # 5 passed
pnpm build                                      # passed, including production web build
git diff --check                                # passed
```

### Security and cost impact

Production composition introduces the expected one bounded Sandbox, optional bounded AI repair,
private artifact storage operations, and one idempotent provider deployment per fresh job. The
existing database quotas and global queue concurrency remain authoritative. Vercel credentials are
required only in the trusted API/worker processes and are not logged or copied into the Sandbox.

### Known limitations

- No live Vercel Sandbox or deployment was run without explicit credential and billing
  authorization; the opt-in provider integration tests remain the pilot gate.
- The worker entry point polls PostgreSQL and processes one claimed job at a time per process;
  horizontal concurrency remains bounded by the queue's database rule.
- An AI client remains an injected optional capability. The deterministic valid fixture reaches
  `READY`; a project that requires AI fails closed when no approved client is configured.
- `PC-302` still owns the complete customer-visible success/failure copy matrix and fixture-driven
  error coverage.

### Handoff to Builder B

After this story merges, `PC-302` may test the real `DeploymentStatusV1` boundary against durable
worker outcomes. It may rely on verified URLs appearing only in `READY`, normalization changes
being durable, stable error codes being recorded, and internal event metadata remaining absent
from customer responses. It must not assume live provider credentials or pilot spending controls
have been validated; those remain explicit `PC-303` work.
