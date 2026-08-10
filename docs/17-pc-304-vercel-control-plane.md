# PC-304 Vercel Control-Plane Handoff

```text
Story: PC-304
Lane: Integration
Branch: agent/pc-304-vercel-control-plane
Tracked issue: #18
Author: Builder A
Required reviewer: Builder B for worker, queue, and provider seams
```

## Outcome

PocketCloud can now ship the customer dashboard and control plane as one Vercel project. Public
`/v1/**` requests are rewritten to the existing Fastify application. Creating a deployment commits
the deployment and Neon job first, then publishes a small `DeploymentDispatchV1` message.

Vercel invokes `api/queue/deployments.js` privately. The consumer claims the exact deployment in
Neon, runs the existing sandbox-to-link pipeline, and acknowledges terminal work. Retryable work
updates the Neon job and checkpoint before the Queue redelivers it. Queue delivery is at least once;
database claims, checkpoints, and Vercel deployment idempotency make duplicates safe.

The worker Function is limited to 60 seconds. Its internal workflow deadline is 50 seconds and its
single provider wait window is 35 seconds, leaving time to record a retry and clean up. A daily
`/api/cron/retention` Function deletes expired private artifacts and requires a 32-character
`CRON_SECRET` Bearer token.

## Runtime layout

```text
Browser
  -> Vercel static UI
  -> /v1/** rewrite
  -> Fastify API Function
       -> Neon transaction
       -> private Vercel Blob upload authorization
       -> Vercel Queue: DeploymentDispatchV1
            -> private worker Function
                 -> exact Neon job claim and checkpoint
                 -> Vercel Sandbox
                 -> approved Vercel deployment
                 -> verified public link

Vercel Cron
  -> authenticated retention Function
  -> expired private Blob and Neon metadata cleanup
```

The committed JavaScript Function entries are intentionally tiny. During `pnpm build:vercel`,
esbuild bundles the TypeScript monorepo implementation into ignored `.vercel-functions/` files.
This avoids changing every internal ESM import solely for Vercel's Function compiler while keeping
the generated multi-megabyte bundles out of Git.

### Hosted runtime hotfix

The first hosted Preview exposed two issues that local compilation did not catch:

1. Vercel treated the literal `api/v1/[...path].js` entry as a static Function path, so public API
   requests returned Vercel `404 NOT_FOUND` before Fastify ran.
2. The ESM bundle reached the CommonJS `pg` dependency and failed during startup with
   `Dynamic require of "events" is not supported`.
3. A limited Vercel project token successfully created a customer deployment but omitted its URL
   from that create response, leaving the worker without an address to verify.

The hotfix replaces that entry with one fixed `api/v1.js` gateway. The public rewrite passes the
wildcard as an internal query parameter, and the gateway reconstructs the original `/v1/**` URL for
Fastify. Function bundles now use CommonJS, matching Node dependencies such as `pg`. The build
cleans the ignored bundle directory first so an obsolete ESM artifact cannot survive locally.
When a limited create response omits the URL, the provider lists recent deployments in the approved
project and selects only the exact deployment ID it just created. This preserves the existing
project allowlist and does not guess or accept a different deployment address.

`vercel/api-path.test.ts` covers rewrite reconstruction and query preservation.
`scripts/test-vercel-function-bundles.mjs` imports every generated Function bundle and asserts that
its handler loads successfully, which directly guards against the production startup failure.

## Files owned and changed

```text
api/**
vercel/**
scripts/build-vercel-functions.mjs
vercel.json
tsconfig.vercel.json
apps/api/src/runtime.ts
apps/api/src/build-app.ts
apps/api/src/services/deployments/deployment-service.ts
apps/worker/src/runtime.ts
apps/worker/src/integration/deployment-worker.ts
packages/core/src/contracts/job.ts
packages/platform/src/database/jobs.ts
packages/platform/src/queue/postgres-deployment-queue.ts
root package manifest, lockfile, documentation, and tests
```

## Shared contracts

`DeploymentDispatchV1` is an additive versioned contract containing only `schemaVersion: 1` and
`deploymentId`. API, Queue adapter, and worker consumer are affected. `DeploymentJobV1`, public API
responses, deployment states, provider interfaces, and database schema are unchanged.

`DeploymentJobRepository.claimNext` adds an optional deployment filter, and
`PostgresDeploymentQueue.claimDeployment` exposes the targeted claim. Existing polling callers keep
their previous behavior.

## Required Vercel environment

Configure these in Preview and Production; never commit them:

```text
DATABASE_URL                 Neon pooled connection string
ACTOR_HASH_SECRET            32+ random characters
VERCEL_TOKEN                 trusted deployment-provider token
VERCEL_PROJECT_NAME          approved customer-deployment project name
VERCEL_PROJECT_ID            approved customer-deployment project ID
VERCEL_TEAM_ID               owning Vercel team ID
CRON_SECRET                  separate 32+ random characters
```

The connected private Blob store supplies its Vercel-managed variables. Vercel injects
`VERCEL_OIDC_TOKEN`, `VERCEL`, region, and deployment identity automatically. Do not manually store
a long-lived OIDC token. `OPERATOR_API_KEY` remains optional; when set, it must be 32+ characters.

Before live testing, run the already-merged Neon migrations against the selected database and
confirm the deployment provider project is intentionally separate from or safe to share with the
PocketCloud control-plane project.

## Verification

```text
pnpm lint                 passed
pnpm typecheck            passed
pnpm test                 134 passed; 3 live-provider tests skipped
pnpm build                passed
pnpm build:vercel         passed
vercel build --target=preview
                          passed; UI and all three Functions emitted
pnpm test:vercel          passed; route tests and all three generated Function bundles load
hosted Preview API probe  passed; PocketCloud validation response replaced Vercel 404/500
hosted ZIP-to-link smoke  passed; deployment reached READY and generated page returned HTTP 200
```

Automated tests use PGlite, in-memory storage, and fake providers. The Vercel build reads project
settings but does not deploy or create Sandbox, Queue, Blob, database, or customer deployment
resources.

## Security impact

- Queue consumer is private and has no public URL.
- Cron uses constant-time Bearer-token comparison.
- Queue payload excludes source, artifact locations, actors, signed URLs, and credentials.
- PostgreSQL remains authoritative for concurrency, retries, and terminal state.
- Function code receives trusted credentials, but Sandbox options and files remain empty of them.
- Generated Function bundles, Vercel link files, pulled environment files, and all `.env*` files
  except `.env.example` are ignored.

Third-party antivirus, reputation, dependency, phishing, and behavioral scanners remain TODO. This
story does not change the `PLATFORM_CHECKS_PASSED` language.

## Cost impact

Each fresh deployment adds one Vercel Queue message and one or more bounded worker Function
invocations. Existing quotas cap deployment and Sandbox usage; Neon claims cap global concurrency
at three. Vercel Queue is a managed beta service and Function, Queue, Sandbox, Blob, Neon, and
deployment usage remains subject to the owner's provider plan and PC-303 spending gates.

## Known limitations

- Vercel environment variables and Neon migrations are an owner-controlled launch step and are not
  committed by this story.
- The current static pipeline may need multiple Queue deliveries when provider publishing exceeds
  one 35-second wait window; checkpointing prevents duplicate normalization or deployment creation.
- Vercel Queue is currently beta. PostgreSQL state keeps the product recoverable, but a future
  provider abstraction may be useful if Queue semantics or pricing change.

## Handoff to the other builder

Builder B may depend on `DeploymentWorker.runDeployment(deploymentId)` receiving only a validated
deployment ID and preserving all existing pipeline behavior. Review targeted claim semantics,
50-second checkpoint/retry behavior, provider idempotency, and cleanup before merge.

Builder B must not assume the live Preview has credentials, migrations, billing gates, or a
successful provider run until the owner completes those launch steps.

## Merge order

No unmerged code dependency. Merge PC-304 after Builder B reviews the shared execution seams and
the required Quality Gate and Vercel Preview checks pass.
