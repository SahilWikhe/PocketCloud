# Builder B Execution-Plane Handoff

## Status and scope

This handoff is the source of truth for Builder B's execution-plane delivery as of August 9,
2026.

| Story | Delivery | Status |
|---|---|---|
| `PC-200` Sample fixtures | PR [#8](https://github.com/SahilWikhe/PocketCloud/pull/8), merge `ba224e8` | Merged |
| `PC-201` Vercel Sandbox provider | PR [#9](https://github.com/SahilWikhe/PocketCloud/pull/9), merge `b310ce9` | Merged |
| `PC-202` Safe ZIP inspection and extraction | Consolidated issue [#10](https://github.com/SahilWikhe/PocketCloud/issues/10) | Implemented on `codex/builder-b-stories` |
| `PC-203` Static project analysis | Consolidated issue #10 | Implemented on `codex/builder-b-stories` |
| `PC-204` Deterministic normalization | Consolidated issue #10 | Implemented on `codex/builder-b-stories` |
| `PC-205` Structured AI repair | Consolidated issue #10 | Implemented on `codex/builder-b-stories` |
| `PC-206` Vercel deployment provider | Consolidated issue #10 | Implemented on `codex/builder-b-stories` |
| `PC-207` Verification and cleanup | Consolidated issue #10 | Implemented on `codex/builder-b-stories` |
| `PC-208` Resumable worker orchestration | Consolidated issue #10 | Implemented on `codex/builder-b-stories` |
| `PC-302` Customer-visible success/failure matrix | Requires `PC-301` | Blocked; `PC-301` is not on `main` or in an open PR |

The user explicitly requested one consolidated branch and pull request for `PC-202` through
`PC-208`. `PC-302` is not included because its required Builder A-authored `PC-301` integration
does not exist yet. This is a dependency block, not an unimplemented execution-plane primitive.

```text
Lane: Execution Plane
Branch: codex/builder-b-stories
Base: main at b310ce9
Tracked issue: #10
Shared contract shapes: unchanged
Shared/public surfaces: additive exports and workspace dependencies
```

## Outcome

Builder B now provides a tested execution lane for the static MVP:

```text
private original artifact
  -> bounded ZIP inspection
  -> static root analysis
  -> deterministic normalization
  -> optional one-shot structured AI patch
  -> deterministic final validation
  -> immutable normalized artifact
  -> Vercel upload/deployment adapter
  -> provider polling and internal logs
  -> HTTPS/HTML verification
  -> verified public URL
  -> guaranteed Sandbox cleanup
```

The worker uses only `DeploymentJobV1` as its input and receives artifact, event, usage, state,
checkpoint, execution, deployment, and cancellation behavior through injected interfaces. It does
not import API routes, web code, database tables, or platform repository internals.

## Public integration surfaces

### `@pocketcloud/core/execution`

New additive Node-only execution subpath exports:

- `archivePolicy`, `inspectAndExtractZip`, and `extractZipArchive`.
- `analyzeStaticProject`.
- Static file/reference inspection and final validation helpers.
- `StaticProjectFile` and finding types.

The main `@pocketcloud/core` entry remains browser-safe and does not export the Node filesystem/ZIP
implementation. No serialized contract, error-code list, provider interface, artifact shape, job payload, usage
shape, event shape, or deployment state was added, removed, or reinterpreted.

### `@pocketcloud/normalizer`

New public exports:

- `normalizeStaticProjectDeterministically`.
- `repairStaticProjectWithAi` and `AiRepairClient`.
- Structured patch schema and deterministic change/hash helpers.

The package never writes to PostgreSQL. It returns normalized files, `NormalizationChangeV1`
records, findings, and AI token usage to its caller.

### `@pocketcloud/deployment`

```ts
import type { DeploymentProvider } from "@pocketcloud/core";
import { VercelDeploymentProvider } from "@pocketcloud/deployment";

const provider: DeploymentProvider = new VercelDeploymentProvider({
  token: process.env.VERCEL_TOKEN!,
  projectName: "pocketcloud-apps",
  projectId: process.env.VERCEL_PROJECT_ID,
  teamId: process.env.VERCEL_TEAM_ID,
});
```

With `exactOptionalPropertyTypes`, production composition should conditionally include optional
values instead of explicitly passing `undefined`.

### `@pocketcloud/worker`

New public exports:

- `WorkerPipeline` and its injected sink/checkpoint interfaces.
- `InMemoryWorkerCheckpointStore` for tests or local development only.
- `DefaultStaticProjectProcessor`.
- `verifyHttpsDeployment`.
- `CleanupCoordinator`.

Production must inject a durable `WorkerCheckpointStore`; the in-memory implementation is not a
replacement for PostgreSQL job/checkpoint state.

## Story details

### PC-202: safe archive handling

`packages/core/src/archive/safe-zip.ts` enforces the documented MVP limits:

| Limit | Value |
|---|---:|
| Compressed ZIP | 10 MiB |
| Expanded bytes | 50 MiB |
| Files | 500 |
| One file | 10 MiB |
| Directory depth | 12 |
| Processing time | 120 seconds |

The parser uses lazy ZIP entry reads and rejects malformed archives, unsupported compression,
encryption, absolute and drive-prefixed paths, traversal, backslashes, control characters, Unicode
normalization aliases, duplicate/case aliases, file/directory conflicts, symbolic or other
non-regular Unix entries, and nested archives. It never materializes link entries.

`inspectAndExtractZip` returns path-sorted in-memory bytes under the same budgets. The filesystem
`extractZipArchive` API first validates the complete archive, writes into a unique temporary sibling
directory with exclusive file creation, and atomically renames only after success. A rejection
removes temporary output and never overwrites an existing assigned directory.

Every hostile generated `PC-200` archive has a rejection test with its expected stable error code.

### PC-203: static project analysis

`analyzeStaticProject`:

- Accepts root `index.html` or exactly one one-level wrapper directory.
- Rejects missing entry points with `ENTRYPOINT_MISSING`.
- Rejects multiple candidate sites with `PROJECT_UNSUPPORTED` rather than guessing.
- Returns the merged `ProjectPlanV1` static shape.
- Adds evidence for the entry point, complete project inventory, local references, and files that
  must be rejected during validation.
- Does not edit bytes and does not call AI.

### PC-204: deterministic normalization and validation

The deterministic normalizer copies input bytes into a canonical output model; it never modifies
the extracted input objects. It:

- Removes only `.DS_Store`, `Thumbs.db`, and `__MACOSX` metadata and records each deletion.
- Moves one accepted wrapper site to the canonical root and records each move.
- Repairs only uniquely resolvable reference-capitalization mismatches.
- Reports missing local resources, developer filesystem URLs, and localhost URLs as repairable
  findings.
- Rejects unknown wrapper siblings instead of silently dropping them.
- Produces deterministic change IDs, before/after SHA-256 values, and customer-safe summaries.

Final validation requires root `index.html`, normalized unique paths, file/total/count budgets,
allowed file types, valid UTF-8 text, practical binary signatures, no secret-like output names, and
resolvable local references. Re-normalizing canonical output produces identical bytes.

### PC-205: one structured AI repair attempt

AI is represented by the injected `AiRepairClient`; no AI SDK or credential crosses into core,
the Sandbox configuration, an artifact, or a job.

The repair flow:

- Runs only when deterministic findings are in the small repairable allowlist.
- Selects at most policy-approved UTF-8 files, with 16 KiB per selected file, 48 KiB selected input,
  and a 12,000 estimated/reported input-token cap.
- Excludes secret-like paths and binary content.
- Makes exactly one structured request.
- Accepts at most five `create`, `replace`, or `delete` text operations.
- Rejects schema extras such as commands, unsafe or duplicate paths, secret paths, unsupported
  types, binary text output, missing/overwritten targets, root entry deletion, output above 64 KiB,
  and output usage above 2,000 tokens.
- Applies accepted operations to a copy, records `source: "ai"` changes, and runs the same
  deterministic final validator.
- Returns AI input/output usage for the worker's `UsageSink`.

### PC-206: Vercel deployment adapter

`VercelDeploymentProvider` pins `@vercel/sdk` `1.28.16` and keeps all Vercel request/response types
inside `packages/deployment`.

Before a provider call, the adapter:

- Parses the shared `ArtifactManifestV1`.
- Accepts only `normalized` or `build_output` artifacts.
- Requires a nonempty project with root `index.html` under the static budgets.
- Rejects customer-owned root `vercel.json`; provider configuration is platform-owned.
- Streams each file through the shared `ArtifactFileSource`.
- Rechecks byte size and SHA-256 against the immutable manifest.
- Generates Vercel's required SHA-1 from verified bytes.

It then uploads the approved files plus a generated platform `vercel.json` and creates a preview deployment with no environment variables, no framework,
no install/build command, a stable PocketCloud idempotency key, and an optional fixed Vercel project
ID. The generated configuration applies `nosniff`, a restrictive CSP, restricted browser
permissions, no referrer, and same-origin opener isolation to every route. Returned URLs must be
HTTPS before becoming a candidate URL.

Provider states map to `PENDING`, `BUILDING`, `READY`, `FAILED`, or `CANCELLED`. Internal events are
bounded to 200 messages, common credential forms are redacted, and SDK objects never cross the
provider interface. `429` maps to retryable `PROVIDER_RATE_LIMITED` with parsed retry guidance;
other 4xx failures are non-retryable and network/5xx failures are retryable
`PROVIDER_DEPLOYMENT_FAILED` errors.

Cancellation first observes terminal state and tolerates provider races/not-found responses.
Removal coalesces concurrent calls and remembers successful/not-found removals within the adapter
instance.

### PC-207: verification and cleanup

`verifyHttpsDeployment`:

- Accepts HTTPS only and rejects embedded URL credentials.
- Uses a 10-second request timeout by default.
- Follows at most three redirects and refuses an HTTP downgrade.
- Requires a successful final response and HTML/XHTML media type.
- Confirms the platform `nosniff`, CSP, and browser-permission headers are active.
- Reads at most 256 KiB and requires an HTML entry document.
- Rejects provider error headers and known provider error-page signatures.
- Returns only the final verified HTTPS URL.

`CleanupCoordinator` coalesces concurrent cleanup, remembers successful cleanup, and allows a
failed operation to be retried. It can stop the Sandbox and remove an unverified provider
deployment. Cleanup failures emit operator-visible events with safe metadata and never replace the
original READY, FAILED, CANCELLED, timeout, or retry outcome.

### PC-208: resumable worker pipeline

`WorkerPipeline.run` consumes `DeploymentJobV1` and follows the merged state order:

```text
SANDBOX_STARTING -> ANALYZING -> NORMALIZING -> VALIDATING
-> READY_TO_DEPLOY -> DEPLOYING -> VERIFYING -> READY
```

It retrieves the immutable original ZIP through `ArtifactStore`, creates a non-persistent bounded
Sandbox, writes the original archive into the fixed workspace, processes static bytes through the
archive/analyzer/normalizer boundaries, writes only normalized output back to the Sandbox, stores a
new normalized artifact, deploys through `DeploymentProvider`, polls bounded provider state,
verifies the candidate URL, and cleans up in a `finally`-equivalent path.

Each stage emits customer-safe events. The validation event uses exactly
`PLATFORM_CHECKS_PASSED`; no code claims malware, antivirus, or general safety. Provider logs appear
only in `internalMetadata`. Sandbox, AI-token, and provider-deployment usage flows through
`UsageSink`.

Checkpoints persist normalized artifact ID, change records, provider deployment, current state,
verified URL, and terminal outcome. A retry reuses the normalized artifact and provider ID, so it
does not repeat artifact or provider creation. Non-retryable failures are terminal and are not
reprocessed on duplicate job delivery. Cancellation is checked between stages and cancels/removes
an existing unverified provider deployment.

The default processor performs bounded archive decompression and static transformations as pure
in-memory worker operations after the same ZIP has been placed in the Sandbox; it does not write
extracted input to the trusted host filesystem or execute uploaded commands. Canonical normalized
files are copied into the Sandbox before artifact promotion. If the team later requires all byte
transformation CPU to run inside the microVM, add a bundled Sandbox utility behind the existing
`StaticProjectProcessor` interface without changing the worker/job contract.

## Builder A integration actions

### Operator deployment removal

`apps/api/src/main.ts` still contains the intentional unavailable provider from Builder A's
handoff. In `PC-301` or a small coordinated seam change, construct `VercelDeploymentProvider` in
the trusted host and inject it into `buildApi` so operator suspension calls its idempotent
`remove(providerDeploymentId)` method. Do not use `VercelSandboxExecutionProvider` for published
deployment removal.

### Production worker composition

Builder A should compose public interfaces only:

1. Claim `DeploymentJobV1` with `PostgresDeploymentQueue`.
2. Use `PlatformArtifactStore` for `originalArtifactId` reads and normalized writes.
3. Adapt durable deployment state/events/usage/checkpoints to the corresponding worker sinks.
4. Construct `VercelSandboxExecutionProvider` and `VercelDeploymentProvider` in the trusted worker
   process.
5. Configure an approved `AiRepairClient` without sending its credential to the Sandbox.
6. Run `WorkerPipeline.run(job)` and apply retry policy only when `PocketCloudError.retryable` is
   true.
7. Preserve internal event metadata filtering in the customer API.

Do not import worker implementation files into API routes, and do not make the worker import API or
web code.

### PC-301 and PC-302

Builder A authors `PC-301`; Builder B reviews execution wiring. After `PC-301` is merged, Builder B
can author `PC-302` against the real customer response and UI seams. The `PC-302` fixture matrix
must cover every stable error category, retry guidance, change summaries, and verified URL while
proving raw code, provider logs, internal metadata, and credentials never enter customer responses.

## Shared files and interface impact

The consolidated branch changes these coordinated public/shared files:

- `README.md` and this handoff.
- `pnpm-lock.yaml`.
- Package manifests for core, normalizer, deployment, and worker.
- Public `index.ts` exports for core, normalizer, deployment, and worker.

Dependencies added:

- `yauzl` `3.2.0` and its TypeScript declarations for streaming ZIP handling.
- `@vercel/sdk` `1.28.16` for deployment operations.
- Existing workspace package links from the worker to execution, normalizer, and deployment.
- `zod` as an explicit normalizer dependency for the structured patch schema.

No shared serialized contract or database migration changed. Builder A must review the additive
public exports, lockfile, status/error interpretation, and worker/platform seam before merge.

## Security impact

Implemented controls include:

- Bounded streaming ZIP parsing and atomic extraction cleanup.
- No path traversal, absolute path, alias overwrite, links, control paths, encrypted entries, or
  nested archives.
- Immutable extracted/normalized byte copies and SHA-256 verification at artifact boundaries.
- Static allowlist plus UTF-8, null-byte, binary-signature, secret-name, budget, and reference
  validation.
- Deterministic work before AI; one structured bounded AI attempt with no command capability.
- No PocketCloud credential, database URL, storage token, AI key, or deployment token in Sandbox
  files/options/commands.
- Provider SDK isolation, bounded/redacted internal logs, and customer-safe stable errors.
- HTTPS-only final verification before exposing a URL.
- Cleanup on success, failure, cancellation, timeout, and retry.

This is not antivirus, reputation, phishing, dependency, secret-scanner, or behavioral scanning.
The only allowed positive security language is `PLATFORM_CHECKS_PASSED`.

## Cost impact

The default unit and end-to-end suites mock Vercel and AI calls. They do not create billable
resources. Production execution introduces:

- One bounded Sandbox creation per fresh processing attempt.
- One optional AI request per eligible deployment.
- One Vercel deployment request per stable deployment idempotency key.
- Artifact storage reads/writes and Vercel file uploads.

The worker reports Sandbox creation/time/memory, AI tokens, and provider deployments through
`UsageSink`. Control-plane quotas and global claim concurrency must remain enabled. Provider account
spending controls are still a `PC-303` pilot-readiness responsibility.

## Verification

Automated commands run on Node.js 24:

```text
pnpm check
node --test tests/sample-apps/catalog.test.mjs
pnpm build
```

At handoff preparation, `pnpm check` passes with:

- Core: 30 tests.
- Execution: 8 mocked tests; 1 live Sandbox test skipped.
- Normalizer: 19 tests.
- Deployment: 13 mocked tests; 1 live deployment test skipped.
- Worker: 19 tests.
- Platform: 5 tests.
- API: 4 tests.
- Web: 3 tests.

The standalone fixture catalog adds 5 passing tests. The mocked/default total is 106 passing tests;
the two real Vercel integration tests are opt-in and were not run because no explicit credential
and billing authorization were supplied.

Run live checks only with approved test resources:

```text
pnpm --filter @pocketcloud/execution test:integration:vercel
pnpm --filter @pocketcloud/deployment test:integration:vercel
```

## Known limitations and explicit non-guarantees

1. `PC-301` production composition is not merged, so the API queue does not yet invoke the worker
   pipeline and the API operator entry point still needs the real deployment provider.
2. `PC-302` is blocked on `PC-301`; no claim is made that the final customer success/failure matrix
   is integrated.
3. The real Vercel Sandbox and deployment tests remain unexecuted. SDK typing and mocked behavior
   pass, but account permissions, billing, region behavior, and current provider responses require
   an approved live test.
4. Sandbox/deployment idempotency caches inside provider classes are process-local. Durable worker
   idempotency comes from the injected checkpoint store and provider deployment ID.
5. `InMemoryWorkerCheckpointStore` is test/local-only. Production requires a durable adapter and
   coordinated lease/heartbeat handling.
6. Provider log redaction is defense in depth, not a general secret scanner. Logs must remain
   internal and excluded by the API.
7. The static MVP does not authorize uploaded install, build, start, or shell commands.
8. Verification confirms an HTTPS HTML root and rejects known provider failures; it does not
   execute customer JavaScript or prove semantic application correctness.
9. Third-party security engines remain documented TODOs.

## Builder A review checklist

- [ ] Review additive public exports and the lockfile.
- [ ] Confirm no serialized core contract or database migration changed.
- [ ] Wire `VercelDeploymentProvider.remove` into operator suspension.
- [ ] Provide durable state, event, usage, and checkpoint sinks to `WorkerPipeline`.
- [ ] Preserve queue claim/lease/retry rules and pass only `DeploymentJobV1` to the worker.
- [ ] Keep all credentials in trusted process composition and outside Sandbox inputs.
- [ ] Keep provider logs and `internalMetadata` out of customer responses.
- [ ] Run both opt-in Vercel tests with explicit cost authorization before pilot use.
- [ ] Author `PC-301`, request Builder B review, then unblock `PC-302`.
- [ ] Use `PLATFORM_CHECKS_PASSED`; never claim malware-free or virus-free.

## Final handoff statement

Builder B's assigned execution stories `PC-200` through `PC-208` now have implementations and
automated coverage. `PC-200` and `PC-201` are already merged; `PC-202` through `PC-208` are delivered
on the consolidated branch requested by the user. The next required merge is this execution-plane
branch, followed by Builder A's `PC-301` production composition. Builder B's `PC-302` authorship
remains blocked until that dependency lands.
