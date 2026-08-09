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
