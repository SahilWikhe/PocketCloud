# MVP User Stories and Work Breakdown

## How to use this backlog

This file defines the initial implementation stories, ownership boundaries, dependencies, and acceptance criteria. It is a baseline plan, not the live status board.

Create one GitHub Issue per story when implementation begins. Use the issue assignment and linked pull request as the live source of truth.

Story sizes are relative:

- **S:** narrow and normally one small PR.
- **M:** meaningful feature with several tests.
- **L:** integration-heavy; split if the PR becomes difficult to review.

## Recommended assignment

| Builder | Workstream | Stories |
|---|---|---|
| Builder A | Control Plane | PC-001, PC-002, PC-101 through PC-106 |
| Builder B | Execution Plane | PC-200, PC-201 through PC-208 |
| Both, one designated author | Integration | PC-301 through PC-304 |

The two builders should exchange review responsibility: Builder A reviews execution-plane integration seams; Builder B reviews control-plane job and artifact contracts.

## Backlog summary

| ID | Story | Owner | Size | Dependencies | Parallel-safe partner |
|---|---|---|---:|---|---|
| PC-001 | Scaffold the TypeScript monorepo | A | M | None | PC-200 |
| PC-002 | Define shared domain contracts | A | M | PC-001 | None; merge quickly |
| PC-200 | Create static and hostile fixtures | B | M | None | PC-001 |
| PC-101 | Create PostgreSQL schema and repositories | A | M | PC-002 | PC-201 or PC-206 |
| PC-102 | Create private upload and artifact flow | A | M | PC-101 | PC-202 |
| PC-103 | Create deployment lifecycle API | A | M | PC-101 | PC-203 or PC-206 |
| PC-104 | Add job claims, quotas, and usage records | A | M | PC-101, PC-103 | PC-204 or PC-205 |
| PC-105 | Build upload and progress UI | A | M | PC-102, PC-103 | PC-205 or PC-207 |
| PC-106 | Add suspension and operator controls | A | S | PC-103, PC-206 | PC-208 |
| PC-201 | Implement Vercel Sandbox provider | B | M | PC-001, PC-002 | PC-101 |
| PC-202 | Implement safe ZIP inspection and extraction | B | M | PC-200, PC-201 | PC-102 |
| PC-203 | Analyze static projects | B | M | PC-202 | PC-103 |
| PC-204 | Normalize static projects deterministically | B | M | PC-203 | PC-104 |
| PC-205 | Add one structured AI repair attempt | B | M | PC-204 | PC-104 or PC-105 |
| PC-206 | Implement the Vercel deployment provider | B | M | PC-002 | PC-101 or PC-103 |
| PC-207 | Verify deployments and guarantee cleanup | B | M | PC-201, PC-206 | PC-105 |
| PC-208 | Orchestrate the worker pipeline | B | L | PC-202 through PC-207 | PC-106 |
| PC-301 | Connect the end-to-end deployment flow | A author, B reviewer | L | PC-102 through PC-105, PC-208 | None |
| PC-302 | Cover customer-visible success and failures | B author, A reviewer | M | PC-301 | None |
| PC-303 | Complete pilot readiness review | Both | M | PC-106, PC-302 | None |
| PC-304 | Run the control plane on Vercel | A author, B reviewer | L | PC-301, PC-303 software controls | None |

## Product expansion stories

These stories turn the controlled prototype into a customer product. The implementation owner is
temporarily covering both work lanes, but the one-story branch, contract review, and merge-order
rules still apply.

| ID | Story | Size | Dependencies |
|---|---|---:|---|
| PC-401 | Add accounts, workspaces, landing page, and customer dashboard | L | PC-304 |
| PC-402 | Add customer delete, suspend, restore, and redeploy controls | L | PC-401 |
| PC-403 | Add verified custom domains | L | PC-402 |
| PC-404 | Add plans, Stripe billing, invoices, and spend limits | L | PC-401, PC-402 |
| PC-405 | Add email and in-product notifications | M | PC-401, PC-402 |
| PC-406 | Publish retention, privacy, and terms controls | M | PC-401, PC-402, PC-404 |

### PC-401 — Add accounts, workspaces, landing page, and customer dashboard

**User story**

> As a customer, I want a real account and private dashboard so my projects and deployment history
> remain mine across devices and browser sessions.

**Acceptance criteria**

- A public landing page explains the product, launch flow, and planned pricing.
- Clerk owns registration, login, sessions, account recovery, and customer password handling.
- The first signed-in request idempotently creates one PocketCloud user, personal workspace, and
  owner membership in Neon.
- Hosted upload and deployment routes derive ownership from the verified session rather than a
  browser-provided identifier.
- New apps are attached to the personal workspace.
- The dashboard shows apps, live links, status, and recent deployment history.
- Cross-workspace app and deployment access is denied and covered by tests.
- Existing prototype records are not silently claimed by new accounts.

### PC-402 — Add customer lifecycle controls

**User story**

> As a customer, I want to redeploy, suspend, restore, and delete my own project so I control its
> public availability and data lifecycle without operator help.

**Acceptance criteria**

- Each action verifies workspace ownership and current state.
- Redeploy creates a new immutable version or explicitly republishes an approved version.
- Suspend removes public availability without deleting source history.
- Restore is explicit and cannot revive an operator-blocked project.
- Delete is a recoverable soft-delete first, followed by retention-driven provider and artifact
  cleanup.
- Actions are idempotent, audited, visible in the dashboard, and covered by race tests.

### PC-403 — Add verified custom domains

**User story**

> As a customer, I want to attach my own domain and receive clear DNS instructions so my project can
> use a professional address.

**Acceptance criteria**

- Domain ownership is scoped to one workspace and one app.
- PocketCloud uses the Vercel domain API behind the deployment adapter boundary.
- The dashboard shows verification records and pending, verified, conflict, and failed states.
- Removing an app or subscription safely detaches its domain.
- Domain conflicts never disclose another customer's account or app.

### PC-404 — Add plans, billing, invoices, and spend limits

**User story**

> As a customer, I want transparent plans and hard spend controls so I can pay for PocketCloud
> without surprise usage charges.

**Acceptance criteria**

- Stripe owns payment details, checkout, invoices, refunds, and the billing portal.
- Neon stores customer/subscription references, entitlements, usage totals, and webhook audit state.
- Signed Stripe webhooks are idempotent and authoritative for subscription state.
- Plan entitlements are enforced server-side before paid provider work begins.
- A customer may set a hard monthly spend limit; PocketCloud blocks new paid work before exceeding
  it and clearly explains the block.
- The dashboard shows plan, usage, invoice access, and the next billing date.

### PC-405 — Add email and in-product notifications

**User story**

> As a customer, I want useful notifications when important actions finish or need attention so I do
> not have to keep the dashboard open.

**Acceptance criteria**

- Deployment-ready, deployment-failed, domain, billing, and retention notices use durable events.
- Resend sends transactional email; Neon stores in-product notification state and delivery audit.
- Delivery is retryable and idempotent, and never blocks a deployment from reaching its terminal
  state.
- Customers can manage notification preferences.

### PC-406 — Publish retention, privacy, and terms controls

**User story**

> As a customer, I want clear policies and usable data controls so I understand what PocketCloud
> stores and can remove my account and projects.

**Acceptance criteria**

- Public privacy, terms, acceptable-use, and retention pages are versioned and linked in product.
- Sign-up records the accepted policy version and time.
- Customer delete flows explain recovery windows and final cleanup.
- Account export and deletion requests are durably tracked.
- Artifact, deployment, billing, security, and legal retention schedules are explicit and tested.

## Foundation stories

### PC-001 — Scaffold the TypeScript monorepo

**User story**

> As a developer, I want a consistent workspace and package structure so both builders can implement separate areas without inventing their own tooling.

**Owner:** Builder A
**Size:** M
**Dependencies:** None
**Parallel-safe with:** PC-200

**Primary paths**

```text
package.json
workspace configuration
lockfile
shared TypeScript/test/lint configuration
apps/* package shells
packages/* package shells
```

**Acceptance criteria**

- The package manager and workspace layout are documented.
- `apps/web`, `apps/api`, and `apps/worker` exist as independently runnable package shells.
- `packages/core`, `normalizer`, `execution`, `deployment`, `platform`, and `config` exist only with the minimum files necessary to build.
- A single root command runs type checking and tests across the workspace.
- Packages use explicit public exports rather than deep cross-package imports.
- No Vercel, Neon, AI, or storage behavior is implemented in this story.
- A clean install and baseline checks pass.

**Out of scope**

- Business domain contracts
- Database schema
- Provider adapters
- User interface features

### PC-002 — Define shared domain contracts and state machine

**User story**

> As both workstreams, we want one stable vocabulary for jobs, artifacts, project plans, states, events, and errors so our independently implemented components connect without translation or duplication.

**Owner:** Builder A; Builder B must review
**Size:** M
**Dependencies:** PC-001
**Parallel-safe with:** No dependent feature; merge this quickly

**Primary paths**

```text
packages/core/src/domain/**
packages/core/src/contracts/**
packages/core/src/errors/**
packages/core/src/index.ts
```

**Acceptance criteria**

- The contracts in `docs/11-shared-contracts.md` exist as versioned TypeScript types or schemas.
- Deployment state transitions are explicitly validated.
- Stable error codes include the MVP upload, archive, validation, provider, and retry categories.
- Contracts contain PocketCloud types only; no Vercel, Neon, Blob, or AI SDK types leak through.
- Serialization tests prove API and worker can exchange the same payload.
- Builder B approves the interface before merge.

### PC-200 — Create static, broken, and hostile sample fixtures

**User story**

> As the execution-plane developer, I want a repeatable catalog of project uploads so normalization and safety behavior can be developed independently from the API and UI.

**Owner:** Builder B
**Size:** M
**Dependencies:** None
**Parallel-safe with:** PC-001

**Primary paths**

```text
tests/sample-apps/**
tests/sample-apps/README.md
```

**Fixture catalog**

- Valid root static site
- Valid site nested one wrapper directory deep
- Missing `index.html`
- Missing referenced image
- Incorrect filename capitalization
- Absolute local filesystem path
- `localhost` reference
- Disallowed executable extension
- Unexpected binary content under a text extension
- Excessive directory depth
- Path traversal archive
- Symlink archive
- Nested ZIP
- File-count and expanded-size limit cases generated during tests

**Acceptance criteria**

- Every fixture has an expected classification and result documented.
- Hostile archive fixtures are generated safely and are never extracted by developer tooling outside a controlled test directory.
- Fixtures contain no real malware.
- No root workspace or shared-contract file is changed.

## Control-plane stories — Builder A

### PC-101 — Create PostgreSQL schema and repositories

**User story**

> As PocketCloud, I want durable records for apps, versions, artifacts, deployments, events, jobs, changes, and usage so processing can resume and be audited independently of a browser session.

**Size:** M
**Dependencies:** PC-002
**Parallel-safe with:** PC-201 or PC-206

**Primary paths**

```text
packages/platform/src/database/**
database migrations
```

**Acceptance criteria**

- The MVP subset from `docs/04-data-and-storage.md` is represented in migrations.
- Foreign keys and unique constraints enforce version, deployment, artifact, and idempotency invariants.
- Original artifacts cannot be mutated through repository methods.
- Deployment-event sequence ordering is enforced.
- Repository tests run against an isolated test database.
- Serverless-safe pooled connection configuration is documented.

### PC-102 — Create private upload and artifact flow

**User story**

> As a customer, I want my ZIP accepted into private quarantine without passing through a long API request so the upload is reliable and never publicly exposed.

**Size:** M
**Dependencies:** PC-101
**Parallel-safe with:** PC-202

**Primary paths**

```text
apps/api/src/routes/uploads/**
apps/api/src/services/artifacts/**
packages/platform/src/storage/**
```

**Acceptance criteria**

- API creates an upload intent and immutable app-version record.
- Upload destination is private, single-purpose, size-bounded, and expires.
- Completion verifies size and records SHA-256.
- Raw storage keys are generated internally.
- The original artifact is marked `QUARANTINED` and receives no public URL.
- Duplicate completion is idempotent.
- The execution plane can later retrieve an artifact by contract, not by accessing API internals.

### PC-103 — Create deployment lifecycle API

**User story**

> As a customer, I want to start a deployment and reconnect to its progress so deployment does not depend on keeping one browser request open.

**Size:** M
**Dependencies:** PC-101
**Parallel-safe with:** PC-203 or PC-206

**Primary paths**

```text
apps/api/src/routes/deployments/**
apps/api/src/services/deployments/**
```

**Acceptance criteria**

- Create endpoint accepts an idempotency key and returns a deployment ID promptly.
- Status endpoint returns current state and customer-safe events.
- Invalid state transitions are rejected.
- Internal metadata and provider logs are not returned to customers.
- Browser reconnection does not affect worker processing.
- Contract tests use the merged shared types.

### PC-104 — Add job claims, quotas, and usage records

**User story**

> As PocketCloud, I want durable usage controls and exclusive job claims so traffic and retries cannot create duplicate expensive work.

**Size:** M
**Dependencies:** PC-101, PC-103
**Parallel-safe with:** PC-204 or PC-205

**Primary paths**

```text
packages/platform/src/queue/**
packages/platform/src/database/usage/**
apps/api/src/services/quotas/**
```

**Acceptance criteria**

- Prototype quota supports hourly, daily, concurrent, and upload-size limits.
- Quota check plus deployment creation is transactional.
- One worker can claim a job atomically.
- Claims expire or heartbeat so crashed workers do not strand jobs.
- Retry availability and maximum attempts are stored durably.
- Usage events record deployment, upload bytes, AI usage placeholders, and Sandbox duration placeholders.
- Tests cover concurrent create and claim races.

### PC-105 — Build upload and progress UI

**User story**

> As a customer, I want to upload my site, understand what PocketCloud is doing, and receive either a link or a useful error.

**Size:** M
**Dependencies:** PC-102, PC-103
**Parallel-safe with:** PC-205 or PC-207

**Primary paths**

```text
apps/web/**
```

**Acceptance criteria**

- Customer selects or drops a ZIP.
- Client rejects obviously oversized files before upload while treating the server as authoritative.
- Upload and deployment creation use the API contracts.
- UI polls or subscribes to deployment status.
- Progress language follows `docs/02-upload-and-deployment-pipeline.md`.
- Terminal success displays the public URL and change summary.
- Terminal failure displays the customer-safe message and retry guidance.
- No raw provider, Sandbox, or AI logs are shown.

### PC-106 — Add suspension and operator controls

**User story**

> As an operator, I want to disable a harmful or broken app immediately so PocketCloud can respond to abuse or incidents.

**Size:** S
**Dependencies:** PC-103, PC-206
**Parallel-safe with:** PC-208

**Primary paths**

```text
apps/api/src/routes/operator/**
apps/api/src/services/suspension/**
packages/platform/src/database/apps/**
```

**Acceptance criteria**

- Authorized operator can move an app to `SUSPENDED`.
- Public alias is removed or disabled through the deployment provider contract.
- Queued work is cancelled and new deployment is rejected.
- The action records actor, reason, and time.
- Re-enabling requires an explicit authorized action.

## Execution-plane stories — Builder B

### PC-201 — Implement Vercel Sandbox provider

**User story**

> As the worker, I want a provider-neutral isolated environment so every upload is processed without access to PocketCloud infrastructure.

**Size:** M
**Dependencies:** PC-001, PC-002
**Parallel-safe with:** PC-101

**Primary paths**

```text
packages/execution/**
```

**Acceptance criteria**

- Provider implements create, write, run, read, and stop operations.
- Sandbox is non-persistent and tagged with deployment ID.
- Default network policy denies outbound access.
- No PocketCloud credential is provided to the Sandbox.
- Static processing exposes no public port.
- Timeout and resources are explicitly bounded.
- Cleanup is safe to call more than once.
- Tests mock provider calls; one opt-in integration test verifies real Sandbox behavior.

### PC-202 — Implement safe ZIP inspection and extraction

**User story**

> As PocketCloud, I want uploads extracted under strict limits so archive structure cannot escape the Sandbox or consume uncontrolled resources.

**Size:** M
**Dependencies:** PC-200, PC-201
**Parallel-safe with:** PC-102

**Primary paths**

```text
packages/core/src/archive/**
packages/core/src/policies/archive*
```

**Acceptance criteria**

- Compressed, expanded, file-count, single-file, depth, and time limits are enforced.
- Absolute paths, traversal, symlinks, hard links, control characters, and nested archives are rejected.
- Extraction never writes outside the assigned directory.
- Partial output is discarded after rejection.
- Error codes match the shared taxonomy.
- Every relevant PC-200 hostile fixture has a passing rejection test.

### PC-203 — Analyze static projects

**User story**

> As PocketCloud, I want to identify the actual static-site root and entry point so common ZIP layouts can be normalized automatically.

**Size:** M
**Dependencies:** PC-202
**Parallel-safe with:** PC-103

**Primary paths**

```text
packages/core/src/analyzer/**
```

**Acceptance criteria**

- Analyzer identifies root-level and one-wrapper-directory static sites.
- Ambiguous multiple sites are rejected rather than guessed.
- `index.html`, file inventory, references, and unsupported files are reported.
- Analyzer returns the merged `ProjectPlan` contract.
- It does not edit files or call AI.
- Tests cover valid, missing, and ambiguous roots.

### PC-204 — Normalize static projects deterministically

**User story**

> As a customer, I want common static-site packaging problems repaired consistently without paying for AI.

**Size:** M
**Dependencies:** PC-203
**Parallel-safe with:** PC-104

**Primary paths**

```text
packages/normalizer/src/deterministic/**
packages/normalizer/src/change-log/**
packages/core/src/validators/**
```

**Acceptance criteria**

- Creates a canonical output directory without modifying extracted input.
- Removes only explicitly known irrelevant metadata.
- Fixes unambiguous wrapper-directory and filename-capitalization problems.
- Reports local absolute paths, `localhost`, and missing assets.
- Records every change using `NormalizationChange`.
- Final validation confirms root `index.html`, allowed files, budgets, and resolvable local references.
- Re-running normalization produces the same result.

### PC-205 — Add one structured AI repair attempt

**User story**

> As a customer with a repairable static project, I want PocketCloud to resolve limited ambiguous problems while keeping AI changes constrained and explainable.

**Size:** M
**Dependencies:** PC-204
**Parallel-safe with:** PC-104 or PC-105

**Primary paths**

```text
packages/normalizer/src/ai/**
packages/normalizer/src/patches/**
```

**Acceptance criteria**

- AI is called only when deterministic findings allow repair.
- Selected UTF-8 files and total tokens are bounded.
- Secret-bearing and binary files are excluded.
- Response conforms to a structured patch schema.
- Patch validator rejects unsafe paths, unsupported types, excessive changes, commands, and binary text output.
- One attempt is allowed in the MVP.
- Deterministic validation runs after patch application.
- AI usage and accepted changes are reported through contracts, not written directly to the database.

### PC-206 — Implement the Vercel deployment provider

**User story**

> As PocketCloud, I want an approved artifact published through a replaceable Vercel adapter so provider details do not spread across the product.

**Size:** M
**Dependencies:** PC-002
**Parallel-safe with:** PC-101 or PC-103

**Primary paths**

```text
packages/deployment/**
```

**Acceptance criteria**

- Adapter accepts only the shared `ArtifactManifest` and file source abstraction.
- Current Vercel upload and deployment workflow is isolated inside the adapter.
- Provider state maps into PocketCloud status without leaking SDK types.
- Logs are available internally through the provider contract.
- Retryable and non-retryable errors map to stable error codes.
- Cancellation and removal are idempotent.
- Unit tests mock the Vercel SDK; one opt-in integration test deploys a tiny fixture.

### PC-207 — Verify deployments and guarantee cleanup

**User story**

> As a customer, I want PocketCloud to confirm the published URL works and clean up temporary resources regardless of the outcome.

**Size:** M
**Dependencies:** PC-201, PC-206
**Parallel-safe with:** PC-105

**Primary paths**

```text
apps/worker/src/workflows/verification*
apps/worker/src/workflows/cleanup*
```

**Acceptance criteria**

- HTTPS root is checked after provider success.
- Unexpected provider error pages become `VERIFICATION_FAILED`.
- Sandbox stop runs on success, failure, cancellation, and timeout.
- Cleanup is idempotent.
- Cleanup failures are logged as operator-visible events without replacing the original deployment outcome.
- Tests cover every terminal path.

### PC-208 — Orchestrate the worker pipeline

**User story**

> As PocketCloud, I want one resumable worker workflow that coordinates isolation, normalization, deployment, verification, events, and cleanup.

**Size:** L
**Dependencies:** PC-202 through PC-207
**Parallel-safe with:** PC-106

**Primary paths**

```text
apps/worker/**
```

**Acceptance criteria**

- Worker consumes only the merged `DeploymentJob` contract.
- State transitions follow the shared state machine.
- Original artifact is retrieved through the storage abstraction.
- Static project follows Sandbox, analyze, normalize, optional AI, validate, artifact, deploy, verify, and cleanup stages.
- Each stage emits customer-safe and internal events through an event sink abstraction.
- Job retries resume safely or repeat idempotently.
- Worker never imports API route or web code.
- End-to-end worker tests use fake providers plus sample fixtures.

## Integration stories

### PC-301 — Connect the end-to-end deployment flow

**User story**

> As a customer, I want one upload action to create a durable job, run the worker, and return a verified live URL.

**Owner:** Builder A authors integration; Builder B reviews execution wiring
**Size:** L
**Dependencies:** PC-102 through PC-105, PC-208

**Acceptance criteria**

- Valid fixture completes from upload intent to `READY`.
- Database records, events, artifacts, usage, and provider IDs agree.
- UI can disconnect and reconnect during processing.
- Duplicate requests do not create duplicate provider deployments.
- Production credentials remain outside the Sandbox.
- Integration uses public package interfaces only.

### PC-302 — Cover customer-visible success and failures

**User story**

> As a customer, I want consistent explanations for successful repairs and failed checks so I know what PocketCloud did and what I can do next.

**Owner:** Builder B authors failure matrix; Builder A reviews API/UI behavior
**Size:** M
**Dependencies:** PC-301

**Acceptance criteria**

- Happy path shows change summary and URL.
- Every stable error category has customer-safe copy.
- Archive and policy rejections do not retry.
- Provider limits include useful retry guidance.
- Raw code, provider logs, and secrets never appear in customer responses.
- Fixture-driven tests cover the documented failure matrix.

### PC-303 — Complete pilot readiness review

**User story**

> As the PocketCloud team, we want a controlled pilot checklist so the prototype cannot silently exceed its security or spending assumptions.

**Owner:** Both builders; one author designated before work starts
**Size:** M
**Dependencies:** PC-106, PC-302

**Acceptance criteria**

- Vercel Pro usage and hard spending controls are reviewed.
- OpenAI recharge and per-deployment budget are configured.
- Quotas and global concurrency are enabled.
- Quarantine retention and cleanup are verified.
- Kill switch works against a live test deployment.
- Operator dashboard or equivalent query exposes queue, failure, Sandbox, AI, storage, and cleanup metrics.
- Security language says `PLATFORM_CHECKS_PASSED`, never malware-free.
- All external security engines remain clearly marked TODO.

### PC-304 — Run the control plane on Vercel

**User story**

> As a customer, I want the hosted PocketCloud page to accept my ZIP and keep processing after the HTTP request ends so I receive a link without the team operating an always-on server.

**Owner:** Builder A authors integration; Builder B reviews worker and provider wiring
**Size:** L
**Dependencies:** PC-301 and the repository-enforced PC-303 controls

**Acceptance criteria**

- The static dashboard and same-origin `/v1` API deploy from one Vercel project.
- Deployment creation publishes a versioned deployment-ID message only after the Neon transaction commits.
- A private Vercel Queue consumer claims only the requested durable Neon job.
- At-least-once delivery cannot duplicate a provider deployment.
- Retryable work is checkpointed in Neon and redelivered with bounded backoff.
- Each Vercel worker invocation fits a 60-second Function window.
- Retention runs daily behind Vercel cron authentication.
- Local API and standalone worker commands remain usable.
- `pnpm check`, `pnpm build`, and `vercel build` pass without production secrets in CI.
- No credential, generated bundle, Vercel link metadata, or pulled environment file is committed.

## Suggested first-week sequence

### Day 1

- Builder A: PC-001
- Builder B: PC-200

### Day 2

- Builder A: PC-002 with Builder B review
- Builder B: finish PC-200 and prepare PC-201 branch only after PC-001 merges

### Days 3-4

- Builder A: PC-101 then PC-102
- Builder B: PC-201 then PC-202

### Days 5+

- Continue lane stories in dependency order.
- Integrate only after the required lane stories are merged.

This is sequencing guidance, not a delivery promise. Keep each builder on one active story and prefer finishing and merging over starting multiple partial tasks.
