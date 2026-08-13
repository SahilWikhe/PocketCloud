# Real-Project Deployment Architecture

## Document status

| Field | Value |
|---|---|
| Status | Proposed target architecture |
| Story | PC-407 documentation and alignment |
| Last reviewed | August 12, 2026 |
| Current shipped scope | Already-built static HTML, CSS, and JavaScript projects |
| Immediate implementation target | Buildable React and Vite projects |
| First full-stack target | Vercel-compatible Next.js applications with optional Neon Postgres |

This document explains how PocketCloud should grow from a static ZIP publisher into a platform
that can understand, repair, test, provision, and deploy real software projects.

It is an architecture agreement, not a claim that the capabilities described here are already
implemented. The sections named **Current reality** and **Target architecture** deliberately
separate shipped behavior from planned behavior.

## Executive summary

PocketCloud should not promise that every arbitrary ZIP can become a correct production
application. It should support increasingly capable project classes with a clear reliability
contract:

1. Finished static websites.
2. Frontend source projects that compile to static output.
3. Single-framework full-stack JavaScript applications.
4. Selected split frontend and backend applications.
5. Broader runtimes and multi-service infrastructure only after another hosting provider or a
   mature Vercel service model is available.

For every supported project, PocketCloud should:

1. Preserve the original upload.
2. Inspect the project and produce an understandable deployment plan.
3. Repair a derived working copy inside a disposable Sandbox.
4. Run repeatable builds, tests, and runtime checks.
5. Ask the customer before making ambiguous, destructive, or paid-resource decisions.
6. Provision only the resources the application actually needs.
7. Deploy an immutable release into an isolated customer-app project.
8. Verify it before assigning the production domain.
9. Record every repair, resource, cost, and lifecycle action.

The AI may change source code and configuration inside the disposable working revision. It may
not hold provider credentials, allocate paid infrastructure, read production data, apply
production migrations, or publish directly. Trusted PocketCloud policy code remains the
authority.

## Product promise and non-promise

The intended promise is:

> Upload a supported project. PocketCloud will understand its shape, repair deployment problems
> when practical, prove that the repaired revision works, create the approved resources, and
> return a working link with a clear record of what changed.

The product must not promise:

- That arbitrary source code is correct.
- That AI can recover missing business requirements, data, assets, or credentials.
- That passing a build proves the application behaves correctly.
- That deterministic platform checks prove an upload is malware-free.
- That every backend architecture belongs on Vercel.
- That a destructive database conversion can be performed without customer review.

Every attempt should end in one honest result:

1. **Deployed unchanged.**
2. **Deployed with repairs**, accompanied by a change report.
3. **Waiting for customer input**, such as a secret, database choice, or architecture decision.
4. **Unsupported**, accompanied by a precise explanation and suggested next step.

## Design principles

### Preserve before changing

The original ZIP is immutable. Analysis, deterministic fixes, AI repairs, builds, and migrations
operate on versioned derived revisions. A customer can inspect or download repaired source, and
PocketCloud can always reproduce or roll back a release.

### Diagnose before spending

PocketCloud should identify the project type, required services, missing inputs, likely cost, and
confidence before creating hosting projects or databases. Ambiguous or paid decisions require a
customer-approved resource plan.

### Deterministic rules before AI

Known repairs belong in ordinary code. AI is reserved for situations that require interpretation
or coordinated multi-file changes. This improves speed, cost, reproducibility, and trust.

### Evidence before production

Source changes do not become a release merely because a model recommends them or the compiler
passes. Tests, builds, runtime checks, browser checks, security policy, and migration checks decide
whether a revision may advance.

### Least infrastructure

If a project needs only static files, PocketCloud creates no backend and no database. If it needs
Postgres, PocketCloud creates or connects only Postgres. It must not invent queues, caches,
storage, or background workers without evidence and approval.

### AI proposes; trusted code authorizes

AI may request reads, searches, validated edits, and approved build commands inside a working
copy. Deterministic code validates each request. AI cannot weaken policy, access secrets, create
resources, deploy, or promote a release.

### Provider-neutral business contracts

PocketCloud concepts must not become Vercel, Neon, Clerk, Blob, or AI-SDK objects. Provider
behavior stays behind narrow adapters so additional runtimes and providers can be added without
rewriting the customer workflow.

### Honest support lanes

A narrow class that works reliably is more valuable than a universal claim that fails
unpredictably. Each framework lane graduates independently through fixtures, canaries, cost
limits, and security tests.

## Current reality

As of August 12, 2026, PocketCloud is a restrictive static-site publisher.

### What works today

- A ZIP containing index.html at its root, or inside one unambiguous wrapper directory.
- Approved HTML, CSS, JavaScript, JSON, image, SVG, and font files.
- Private direct upload with hash, size, and content checks.
- Immutable original and normalized artifacts.
- Deterministic cleanup and static-reference repairs.
- One optional narrow AI patch proposal.
- Static file deployment to Vercel.
- HTTPS and response-header verification.
- Customer accounts, dashboard, deployment history, and lifecycle controls.

### What does not work today

- Installing npm, pnpm, yarn, pip, or other dependencies.
- Building JSX, TSX, TypeScript, Vite, React, Vue, Svelte, Next.js, or Python source.
- Starting or probing customer servers.
- Customer environment-variable collection.
- Customer backends or API routes.
- Customer databases, storage, queues, caches, or workers.
- Browser execution and JavaScript-console verification.
- Multi-attempt build-log-driven AI repair.
- One isolated Vercel project per customer application.

### Current AI boundary

The current AI integration is intentionally a one-shot static patch planner:

- Default model: openai/gpt-5.4-mini through Vercel AI Gateway.
- Low reasoning and a 15-second generation timeout.
- One proposal with at most 20 file operations.
- At most 16 KiB per selected file and 48 KiB selected source in total.
- Approximately 12,000 estimated input tokens and 2,000 output tokens.
- At most 64 KiB of patched text.
- Only approved static text paths.
- No commands, dependency installation, network, credentials, provider access, or deployment.
- Repair eligibility is limited to missing local references, local absolute paths, and localhost
  references.

Changing only the model would not create real-project repair. The analyzer, execution tools,
repair loop, validation, resource planning, and deployment architecture must all expand.

### Current Sandbox gap

A Vercel Sandbox adapter already creates a nonpersistent, secret-free, deny-network environment.
However, the current static pipeline copies files into the Sandbox while analysis and
normalization still execute in the trusted worker process. Uploaded executable code is not run
today, but this boundary is not sufficient for package installation or project builds.

Before buildable projects are enabled, archive extraction, dependency installation, lifecycle
scripts, builds, tests, AI-modified code, and server startup must execute entirely inside the
Sandbox. The trusted worker should orchestrate using identifiers and validated results only.

### Current hosting and database allocation

All customer static releases currently become separate immutable deployments inside one
configured Vercel project. This is acceptable for the limited static pilot but is not the target
for full-stack isolation.

Neon currently stores PocketCloud control-plane data only: customers, workspaces, apps, versions,
jobs, events, usage, provider IDs, and lifecycle state. It does not create databases for uploaded
customer applications. The Vercel and Neon Preview integration isolates PocketCloud's own preview
database; it does not provision customer databases.

## Supported project classes

Support should expand in the following order.

| Lane | Project class | Examples | Frontend | Backend | Database | Initial disposition |
|---|---|---|---|---|---|---|
| 0 | Finished static site | HTML, CSS, JS | Vercel CDN | None | None | Supported now |
| 1 | Buildable frontend | React/Vite, Vue/Vite, Svelte, Astro static | Vercel CDN | None | None | Build next |
| 2 | Vercel-native full stack | Next.js pages, API routes, server actions | Vercel CDN | Vercel Functions | Optional Neon | First full-stack goal |
| 3 | Split JavaScript app | React plus Express, Fastify, or Hono | Vercel | Separate service or Functions | Optional Neon | Add after lane 2 |
| 4 | Selected Python API | React plus FastAPI or Flask | Vercel | Python service | Optional Neon | Later |
| 5 | General infrastructure | Docker, workers, WebSockets, multiple services | Provider-specific | Provider-specific | Provider-specific | Much later or unsupported |

### Lane 1: buildable frontends

This is the immediate target because it delivers real source-code support without introducing
runtime secrets, server processes, or customer data.

The first proof should be:

    Upload React/Vite source
      -> detect package manager and build plan
      -> install and build in Sandbox
      -> repair common build failures when necessary
      -> retrieve dist/
      -> run browser verification
      -> deploy immutable static output

React/Vite should be completed before generalizing to Vue, Svelte, or every frontend framework.

### Lane 2: Vercel-native full stack

Next.js is the preferred first full-stack class. Its frontend assets, API routes, server actions,
and Functions can remain one application and one customer-facing domain. PocketCloud should not
split a cohesive Next.js project merely to create architectural symmetry.

The initial contract should support:

- A single Next.js application root.
- Stateless HTTP behavior.
- Vercel-compatible Functions.
- Declared customer environment variables.
- Optional managed or customer-supplied Postgres.
- Prisma or Drizzle additive migrations after explicit validation.
- Blob storage when durable user files are required.
- Browser, API, and runtime health checks.

### Lane 3: separate frontend and API

A repository containing client/ and server/ is a multi-component application. PocketCloud should
create a plan showing both components, their route binding, secrets, database requirement, and
deployment order.

A typical plan may say:

> React frontend, Node API, and Postgres detected. PocketCloud will create one web application,
> one API service, and one database. The project still needs STRIPE_SECRET_KEY from its owner.

This lane requires coordinated releases and rollback across more than one component. It should
follow, not precede, the single-framework full-stack lane.

### Lane 4 and beyond

Python APIs may be added through a dedicated handler and suitable runtime. Vercel Services can
combine multiple services under one project, but it remains a changing beta capability and must
not be a hard dependency until account availability, limits, and operational behavior are proven.

Persistent daemons, raw TCP servers, arbitrary Docker Compose, durable local disk, WebSocket
servers, native operating-system services, GPU jobs, and always-on background workers do not fit
the initial Vercel Functions contract. PocketCloud should either:

- Return an accurate unsupported result.
- Add a later container-hosting provider adapter.
- Ask the customer to connect an appropriate provider.

It should not silently rewrite these workloads into a materially different product.

## Customer-visible workflow

The customer experience should remain understandable even as the infrastructure becomes more
capable.

### Stage 1: receive and preserve

- The browser uploads directly to private object storage using short-lived authorization.
- PocketCloud records byte size, SHA-256, artifact ID, app, version, and owner.
- The original ZIP is immutable and never receives a public URL.

Customer language:

> Upload received.

### Stage 2: inventory

PocketCloud inspects:

- Candidate project roots and workspaces.
- Package manifests and exactly one package-manager lockfile.
- Framework and runtime versions.
- Build, test, and start commands.
- Frontend, API, worker, and cron components.
- Imports, routes, output directories, and local-file assumptions.
- Environment-variable names and likely sensitivity.
- ORM, schema, and migration files.
- Database, Blob, cache, queue, email, authentication, or payment dependencies.
- Unsupported native, persistent-process, port, or protocol requirements.

The inventory records observed facts and evidence. It does not yet create resources.

Customer language:

> Understanding your project.

### Stage 3: create a deployment and resource plan

Trusted planning policy converts observed evidence into a versioned plan containing:

- Components and their roots.
- Install, build, test, and start commands as argument arrays.
- Runtime and framework.
- Route bindings.
- Required environment-variable names.
- Required hosting, database, and storage resources.
- Missing customer decisions.
- Compatibility warnings.
- Confidence.
- Expected time and bounded resource cost.

AI may explain or propose a plan, but trusted policy validates it. PocketCloud asks before:

- Creating a paid or persistent resource.
- Choosing between competing project roots.
- Changing authentication, payment, or authorization behavior.
- Converting a database engine.
- Applying a destructive migration.
- Removing a large amount of code.

Customer language:

> We found a React frontend and Node API. One secret is still needed.

### Stage 4: create a disposable working revision

PocketCloud creates one isolated Sandbox and copies only the approved source revision into it.
The Sandbox begins:

- Nonpersistent.
- Without PocketCloud or production secrets.
- Without a production database connection.
- Without Vercel, Neon, Blob, Clerk, or AI provider credentials.
- With strict CPU, memory, disk, process, output, and time budgets.
- With default-deny network policy.
- With no public test port.

Every terminal path performs idempotent cleanup. A separate reconciliation process finds and
stops leaked Sandboxes after crashes.

### Stage 5: deterministic preparation and repair

Rules should first handle:

- Removing operating-system junk.
- Unwrapping an unnecessary outer ZIP directory.
- Selecting an unambiguous workspace or project root.
- Selecting npm, pnpm, or yarn from the lockfile.
- Pinning an approved runtime and package-manager version.
- Correcting safe path-capitalization errors.
- Correcting an unambiguous build command or output directory.
- Replacing localhost with a planned same-origin API binding.
- Generating a safe, platform-owned deployment configuration.
- Discovering environment-variable names without reading secret values.

Every accepted change receives before and after hashes, a reason code, and a customer-readable
summary.

### Stage 6: controlled dependency installation

Dependency installation executes attacker-controlled package and lifecycle code. It must never
run in the API, worker, or another trusted process.

The installation phase should:

1. Require a supported manifest and one unambiguous lockfile when present.
2. Use a frozen or immutable install by default.
3. Open network access temporarily only to approved package-registry domains.
4. Perform an initial install with lifecycle scripts disabled when practical.
5. Allow required lifecycle scripts only in a second, explicitly supported phase with no secrets,
   minimum egress, and tighter time and output budgets.
6. Record runtime, package manager, lockfile hash, dependency changes, and provenance.
7. Return the network policy to deny-all before running uploaded code.

Dependency changes proposed by AI require deterministic policy approval and appear in the final
change report.

### Stage 7: build and test

PocketCloud runs approved executable-plus-argument commands. It never runs an arbitrary shell
string supplied by a customer, repository file, or model.

The Sandbox produces bounded, sanitized diagnostics:

- Exit code and duration.
- Standard output and error with secret-like values redacted.
- Type-check, lint, test, and build results.
- Output-manifest summary.
- Runtime and browser failures.

Raw provider output, complete source, and secrets are not written to general logs.

### Stage 8: iterative AI repair

When deterministic fixes do not produce a valid release, PocketCloud starts a bounded repair
session.

The AI receives:

- A redacted repository map.
- Relevant approved text files.
- Manifests and framework evidence.
- Sanitized build, test, browser, and runtime diagnostics.
- Prior repair summaries.
- Protected paths and remaining budget.

The AI may request:

- Read or search of approved project files.
- A structured patch to the working revision.
- An approved install, test, build, or start command.
- Inspection of a sanitized command result.
- Completion as repaired, blocked, or unsupported.

The AI may not request:

- Cloud credentials or signed URLs.
- Production customer data.
- Deployment or domain promotion.
- Database provisioning.
- Production migration.
- Policy changes or Sandbox escape.

Before every attempt, PocketCloud checkpoints the working revision. After each patch, it reruns
the relevant deterministic checks. Failed or regressive changes roll back. The system keeps the
best validated revision rather than the last revision.

The repair budget should use:

- Maximum wall-clock time.
- Maximum model input and output tokens.
- Maximum dollar cost.
- Maximum iterations.
- Maximum changed bytes and files.
- Protected-path risk levels.
- Lack-of-progress stopping rules.

It should not rely primarily on a tiny universal edit-count limit.

### Stage 9: validation

A release candidate must pass the checks appropriate for its lane:

- Reproducible dependency installation.
- Existing tests.
- Type checking and linting when declared.
- Production build.
- Declared output exists and matches its manifest.
- Server starts within a deadline.
- Root and declared health routes respond.
- Browser loads important routes.
- No obvious browser console or network errors.
- API smoke tests pass.
- Database migrations succeed against a disposable database.
- Policy and security checks pass.

Build success is necessary but not sufficient. Existing tests and observed runtime behavior remain
the authority over model confidence.

### Stage 10: provision approved resources

Persistent resources are created only after the application has a viable plan and release
candidate. This avoids spending money on projects that cannot build.

The trusted provisioning workflow:

    reserve customer budget
      -> create or reuse hosting project
      -> create database only when approved
      -> create storage only when approved
      -> bind opaque secret references
      -> deploy immutable release
      -> verify
      -> promote domain

Each external mutation uses a stable idempotency key. A failure runs compensating cleanup where
safe and records any orphan requiring reconciliation.

### Stage 11: deploy, verify, and promote

PocketCloud deploys only the declared release manifest, never the entire Sandbox filesystem.
Provider credentials remain in the trusted adapter.

The release is first a preview. PocketCloud verifies the real provider URL and only then moves the
production alias or domain to that immutable deployment. Rollback repoints the alias to the prior
verified release rather than rebuilding unknown source.

Customer language:

> Your app is live. PocketCloud changed four files and created one database. View changes or
> download the repaired source.

## Resource allocation model

### High-level mapping

| Resource | Purpose | Default location | Lifetime |
|---|---|---|---|
| PocketCloud control database | Users, apps, jobs, plans, provider IDs, status, usage | Existing PocketCloud Neon project | Platform lifetime |
| Original source | Immutable uploaded ZIP | Private Vercel Blob or object storage | Retention policy |
| Working revision | Repair and build copy | Vercel Sandbox | One job |
| Repaired source and diagnostics | Diff, logs, normalized ZIP, release evidence | Private object storage | Version retention policy |
| Static frontend | HTML, JS, CSS, assets | Vercel CDN | App/release lifetime |
| Full-stack frontend and API | Pages, assets, Functions | One Vercel project per app | App lifetime |
| Customer relational data | Application tables and records | Separate customer-app Neon project | App lifetime |
| Customer runtime files | Durable uploads or generated files | Separate Blob/object store binding | App lifetime |
| Preview database | Migration and repair validation | Temporary Neon branch | Short TTL |

### Hosting isolation

The target is one Vercel project per PocketCloud full-stack application. Each revision becomes an
immutable deployment within that project.

This provides independent:

- Framework and build settings.
- Functions and runtime limits.
- Environment variables.
- Custom domains.
- Deployment history and rollback.
- Usage attribution.
- Suspension and deletion lifecycle.

Static deployments may continue on a pooled platform during an early controlled phase if their
origin and lifecycle remain safe, but full-stack applications must not share runtime secrets or
project configuration.

### Backend placement

PocketCloud should choose backend placement from the detected workload:

- **No backend:** deploy only static output.
- **Next.js API routes or server actions:** keep them in the same Vercel project as the frontend.
- **Stateless Node API:** deploy through a supported Functions or service adapter.
- **Selected Python API:** deploy through a Python-capable service adapter after that lane
  graduates.
- **Long-running worker, WebSocket server, raw TCP, durable local disk, or arbitrary container
  topology:** reject initially or select a later provider designed for the workload.

The customer should usually see one domain. Routing can bind / to the frontend and /api to the API
even when the platform uses separate internal components.

### Database allocation

PocketCloud's control-plane database must never contain arbitrary customer application tables or
runtime data.

For every application:

- If no database is detected or requested, create none.
- If Postgres is required, offer **Create a managed database** or **Connect an existing database**.
- If the project already depends on MongoDB, Firebase, Supabase, MySQL, or another service,
  initially collect a connection through the supported secret flow rather than silently
  converting it.
- If an application uses local SQLite, migration to Postgres is a separate customer-approved
  repair. It must preserve behavior and pass data/schema tests; it is not an automatic default.
- If code uses in-memory state that appears to require persistence, PocketCloud may recommend a
  database but must not invent one without approval.

The preferred managed model is one Neon project per customer application:

- A production/default branch stores live data.
- A project-scoped role and pooled connection serve the application.
- Short-lived child branches test repairs and migrations.
- Preview branches expire automatically.
- Compute, storage, deletion, and spend can be attributed to one app.

During early full-stack beta, PocketCloud may first require a customer-supplied DATABASE_URL to
reduce custodial and billing risk. Managed databases should become the default only after resource
lifecycle, retention, backup, metering, and spend controls are proven.

### Migration policy

The AI may repair or propose migration files in the working revision. It never receives the
production database credential.

Migration validation should:

1. Create an empty, schema-only, synthetic, or explicitly authorized sanitized preview database.
2. Apply the full migration history.
3. Start the application against that preview.
4. Run data-contract and API checks.
5. Classify the migration as additive, destructive, data-moving, or ambiguous.

Only proven safe additive migrations may initially be promoted automatically. Dropping or
renaming columns, destructive type changes, bulk data movement, and database-engine conversion
require explicit approval, backup or recovery evidence, and a rollback plan.

PocketCloud must not automatically copy real production customer data into an AI repair or preview
environment.

### Object storage, cache, queues, and schedules

- Runtime file uploads belong in object storage, not local Function disk or Postgres byte columns.
- A cache is created only when the runtime contract and customer plan require it.
- A queue or background worker is a distinct persistent resource with its own limits and provider.
- Scheduled jobs require an explicit schedule, authentication, retry policy, and spend budget.
- External authentication, payments, email, and third-party APIs are environment and integration
  requirements, not capabilities AI should fabricate.

### Managed versus customer-owned resources

The long-term product should support a hybrid model:

- **PocketCloud managed:** fastest onboarding; PocketCloud creates resources and bills within
  declared limits.
- **Bring your own provider:** advanced or high-usage customers connect Vercel, Neon, or another
  supported account.
- **Claim or transfer later:** where supported, a customer may take ownership of a managed
  deployment.

Managed infrastructure gives the best customer experience but makes PocketCloud responsible for
abuse, first-party provider charges, data retention, deletion, and quota enforcement. Internal
metering and spend caps are required before public managed full-stack hosting, even if customer
billing is added later.

## Target architecture

### Logical flow

    Customer
      -> trusted web and API
      -> immutable source storage
      -> durable deployment job
      -> project inventory and plan
      -> disposable Sandbox
         -> deterministic repair
         -> controlled install and build
         -> bounded AI repair loop
         -> tests and runtime verification
         -> immutable release manifest
      -> trusted resource provisioning
      -> provider deployment
      -> preview verification
      -> production promotion

### Modular-monolith package boundaries

PocketCloud should remain a modular TypeScript monorepo. These are code boundaries, not a request
to create a network microservice for every responsibility.

| Module | Owns | Must not own |
|---|---|---|
| packages/core | Versioned contracts, domain state, provider-neutral policy, typed errors | Provider SDKs, database access, command execution |
| packages/normalizer | Deterministic repair, AI repair policy, validated diffs, change records | Sandbox lifecycle, persistence, provisioning, deployment |
| packages/execution | Disposable-workspace capabilities and Sandbox adapters | Framework choice, repair decisions, resource allocation |
| packages/deployment | Release deployment, provider status, verification adapters | AI behavior, customer database creation, control persistence |
| packages/provisioning, added when implemented | Customer hosting/database/storage lifecycle adapters | PocketCloud control-plane repositories |
| packages/platform | PocketCloud database, artifact storage, queues, events, usage sinks | Customer application database access |
| apps/worker | Durable orchestration and composition | Duplicated domain types or provider policy |
| apps/api | Authentication, authorization, customer decisions, quotas, intents | Untrusted execution or direct repair |
| apps/web | Customer plan, approval, progress, changes, and lifecycle UI | Provider credentials or archive processing |

### Dependency direction

    apps/web ----------> browser-safe core contracts

    apps/api ----------> core + platform + provisioning interfaces
    apps/worker -------> core + normalizer + execution
                         + deployment + provisioning + platform

    normalizer --------> core
    execution ---------> core
    deployment --------> core
    provisioning ------> core
    platform ----------> core

    core --------------> no PocketCloud package

Prohibited dependencies:

- Core importing Vercel, Neon, Clerk, Blob, or AI SDKs.
- Normalizer calling Sandbox, PostgreSQL, or deployment providers directly.
- Execution choosing a framework or provisioning resources.
- Deployment importing repair behavior.
- Customer-database adapters importing PocketCloud control-database repositories.
- API routes importing worker implementations.
- One workload handler importing another workload handler.
- AI code calling deployment, domain, secret, or resource adapters.
- Provider SDK types crossing an adapter boundary.

CI should enforce these rules with import restrictions or a dependency-boundary check rather than
relying only on documentation.

### Workload handlers

One generic outer workflow should select a handler for the approved application plan:

    Quarantine
      -> inventory
      -> approve plan
      -> prepare isolated workspace
      -> deterministic repair
      -> install and build
      -> AI repair if necessary
      -> validate
      -> collect immutable release
      -> provision
      -> deploy
      -> verify
      -> promote
      -> clean up

Initial handlers:

- StaticWorkloadHandler.
- ViteWorkloadHandler.
- NextJsWorkloadHandler.
- NodeServiceWorkloadHandler later.
- FastApiWorkloadHandler later.

Adding Python should mean adding a handler and provider capability, not rewriting the static or
Vite path. Avoid framework-general abstractions until at least two real handlers need the same
behavior.

### Versioned contracts

Keep the existing ProjectPlanV1 contract for static serialized jobs. Add a new application-plan
version for multiple components rather than changing old records in place.

The target contract family should keep observed facts, approved decisions, and final resources
separate:

- **ProjectInventory:** observed files, manifests, components, dependencies, and evidence.
- **ApplicationPlan:** approved components, commands, route bindings, environment names, and
  confidence.
- **RepairPlan:** permitted files, commands, protected paths, model tier, and budgets.
- **RepairAttempt:** checkpoint, diff hashes, model, tokens, cost, diagnostics, and result.
- **ValidationReport:** build, test, browser, API, migration, and policy checks.
- **ResourcePlan:** provider-neutral resources, ownership mode, region, limits, and estimated cost.
- **ReleaseManifest:** exact immutable artifacts, Functions, routes, migrations, and provider
  targets.
- **ProvisionedResource:** provider IDs, state, secret references, usage tags, and cleanup status.

All persisted and cross-process contracts:

- Include a schema version.
- Use opaque IDs and ISO UTC dates.
- Receive runtime validation.
- Exclude source bodies, secret values, signed URLs, and provider credentials.
- Evolve additively where semantics remain compatible.
- Use a new schema version for semantic changes.

### Execution capabilities

The execution interface should expand through explicit capabilities, not arbitrary shell access:

- Create and stop a disposable environment.
- Write approved files.
- Change from deny-all to a named allow-domain network phase.
- Run a validated executable and argument array.
- Start a private server with a deadline.
- Inspect server status and bounded logs.
- Read only explicitly approved output paths.
- Cancel and clean up idempotently.

A deterministic command policy validates the executable, arguments, working directory, timeout,
phase, and resource budget. AI requests a tool action; trusted code authorizes and performs it.

### Provisioning capabilities

Customer resources belong behind a distinct provisioning module with narrow interfaces:

- HostingProjectProvider.
- RelationalDatabaseProvider.
- ObjectStorageProvider.
- SecretBindingProvider.
- DomainBindingProvider.

Create, suspend, restore, rotate, and remove operations are idempotent. Provider credentials remain
only in the trusted composition root. External resources carry PocketCloud app, workspace,
environment, and correlation tags for attribution and cleanup.

### State, checkpoints, and idempotency

Every expensive or externally mutating stage writes a durable checkpoint. Replaying a Queue
message or resuming after a crash must not:

- Create duplicate Vercel projects.
- Create duplicate Neon projects or branches.
- Apply a migration twice.
- Count AI or provider usage twice.
- Promote an unverified release.
- Leak a Sandbox or preview database.

Every provider create call uses a stable idempotency key derived from PocketCloud-owned identifiers.
Cleanup records are durable and retryable.

## AI repair architecture

### Model strategy

The current mini model remains suitable for inexpensive static patches. Real-project repair should
use tiered routing through a provider-neutral model interface:

1. Deterministic rules for known issues.
2. A lower-cost model for classification and simple targeted repairs.
3. A strong coding model for multi-file work after build evidence proves escalation is useful.
4. Deterministic builds, existing tests, browser checks, and policy remain the final judge.

The model name must be configurable and re-evaluated before implementation. Architecture must not
depend on one temporary vendor model ID.

### Repair tool contract

The repair model may propose one next action at a time:

- Read an approved file.
- Search approved paths.
- Apply a structured diff.
- Run an approved command.
- Inspect sanitized diagnostics.
- Stop as successful, blocked, or unsupported.

Side effects remain outside the model client. The repair engine does not import provider deployment
or provisioning SDKs.

### Protected areas and approval

Paths and changes receive risk classifications. At minimum, these are protected:

- Environment and credential files.
- CI and repository workflows.
- Infrastructure and provider configuration.
- Authentication and authorization.
- Payments and billing.
- Database migrations.
- Mass deletion or dependency replacement.

Some deployment-safe configuration changes may be automatically approved from known templates.
Authentication, payments, destructive migrations, provider changes, and large semantic rewrites
require stronger review or explicit customer approval.

### Persistence and cost attribution

Every AI generation is expensive and not perfectly reproducible. PocketCloud should record:

- Repair and attempt IDs.
- App, version, deployment, workspace, and checkpoint IDs.
- Model and prompt-template version.
- Sanitized input-manifest hashes.
- Proposed and accepted diff hashes.
- Input and output tokens.
- Estimated or billed cost.
- Duration and outcome.
- Commands and validation results.

Full source and secrets are not copied into generation records. Source revisions and larger
diagnostics remain private artifacts referenced by ID.

### Customer control

The product may later offer:

- **Quick Deploy:** deterministic supported projects with little or no AI.
- **AI Rescue:** broader repair budget, stronger model, multi-file source changes, and a detailed
  report.

Customers should be able to choose whether major repairs pause for review. PocketCloud should
always show the final diff and allow download of repaired source.

## Security architecture

### Threat model

Treat every ZIP, dependency, build script, repository instruction, model output, runtime process,
database migration, and published app as untrusted.

Threats include:

- Archive traversal, aliases, parser exploitation, and ZIP bombs.
- Malicious dependency lifecycle scripts.
- Command injection and Sandbox escape attempts.
- Network exfiltration and SSRF.
- Prompt injection hidden in source, comments, or README files.
- Cross-tenant access.
- Secret theft through logs, builds, AI prompts, or browser output.
- Malicious published JavaScript, phishing, redirects, and downloads.
- Database destruction or production-data exposure.
- Provider quota exhaustion, infinite loops, and cost abuse.
- Orphaned resources and failed cleanup.

Passing platform policy means only:

    PLATFORM_CHECKS_PASSED

PocketCloud must not display SAFE, VIRUS_FREE, or MALWARE_SCAN_PASSED until a real scanner produced
that result.

### Trust zones

1. **Trusted control plane:** web, API, worker orchestration, PocketCloud database, credentials,
   provider adapters, policy.
2. **Untrusted processing zone:** one disposable Sandbox per repair/build job.
3. **Untrusted customer runtime:** the published application and its app-scoped resources.

Uploaded code never runs in a control-plane process. Published apps receive no dashboard cookies,
PocketCloud database access, provider administrative credentials, or cross-app secrets.

Customer apps must remain on a registrable domain separate from the trusted dashboard and auth
cookies. Dashboard previews use a minimally privileged sandboxed iframe.

### Archive and workspace controls

Retain and extend the existing compressed-size, expanded-size, file-count, per-file, depth, nested
archive, and time limits. Continue rejecting:

- Absolute and traversal paths.
- Drive prefixes and control characters.
- Symbolic and hard links.
- Aliases that overwrite normalized paths.
- Secret-bearing and private-key files from deployable output.
- Unsupported executable or binary formats.

Extraction writes only inside the assigned Sandbox workspace. Filename metadata never becomes a
trusted path.

### Sandbox controls

- No PocketCloud, provider, AI, or production database credentials.
- Nonpersistent environment.
- Strict CPU, memory, disk, process, output, port, and time limits.
- Default-deny network.
- Temporary exact-domain registry allowlist only during approved dependency phases.
- Private short-lived test ports only when runtime verification requires them.
- No shared cross-customer build cache until isolation and cache poisoning protections are proven.
- Guaranteed cleanup on success, failure, timeout, cancellation, and reconciliation.

### Secret handling

Plans contain environment-variable names, public/private classification, reason, and readiness;
they never contain values.

Customers provide values through the trusted UI. Values are stored through a secret manager or
provider binding, represented internally by opaque references, redacted from logs, excluded from
AI, and injected only into the specific build or runtime phase that requires them.

Queue messages continue to contain identifiers only: no source, actor details, signed URLs, or
secrets.

### Database safety

- AI never receives production credentials or production data.
- Preview branches use empty, schema-only, synthetic, or explicitly authorized sanitized data.
- Cross-app roles and projects remain separate.
- Production migrations run through trusted policy.
- Destructive or data-moving changes require approval, backup or recovery evidence, and rollback.
- Every database and branch has an owner, purpose, TTL where applicable, spend limit, and cleanup
  state.

### Deployment and visitor safety

- Deploy only declared immutable release output.
- Do not expose a production URL before provider and PocketCloud verification pass.
- Enforce HTTPS, nosniff, Permissions Policy, and a deliberate Content Security Policy.
- Apply WAF, rate limits, browser isolation, and safe custom-domain verification.
- Do not assume arbitrary JavaScript is benign because its file type is allowed.
- Suspension removes public aliases and prevents unauthorized republish.
- Maintain workload, framework, model, provider, workspace, and global kill switches.

### Authentication and authorization

Every app, secret, domain, database, deployment, suspend, restore, delete, and redeploy action
checks authenticated workspace ownership or role. Operator, cron, Queue, and webhook authorization
remain separate from customer sessions and fail closed.

### Abuse and spend controls

- Transactional per-customer deployment quotas.
- One-job-per-app and per-customer concurrency limits.
- Global Sandbox and provider concurrency.
- AI token and dollar budgets.
- Sandbox creation, CPU, memory, network, and duration budgets.
- Vercel, Neon, storage, and bandwidth limits.
- Bounded retries with backoff.
- Automatic temporary suspension for repeated policy abuse.
- A tested platform kill switch.

### Third-party security TODOs

The following remain explicit later integrations, consistent with the decision to implement
code-level safety first:

- Antivirus such as ClamAV.
- Known-malware hash and reputation services.
- Dependency vulnerability and SBOM scanning.
- Advanced secret scanning.
- SAST and framework-aware scanning.
- Container-image vulnerability scanning.
- Phishing and malicious JavaScript detection.
- Headless-browser behavioral analysis.
- Human security review and abuse operations.

Until those systems exist, PocketCloud must not claim that uploads are malware-free.

## Engineering and coding standards

### Type and boundary safety

- Keep TypeScript strict mode enabled for every package.
- Parse and validate every external boundary: HTTP, Queue, stored JSON, provider response, AI
  response, and persisted contract.
- Prefer readonly domain values and immutable artifacts.
- Use exhaustive domain states and stable typed error codes.
- Keep internal diagnostics separate from customer-safe errors.
- Use executable and argument arrays; never construct shell commands from untrusted strings.

### Side-effect discipline

- Keep analyzers, planners, policies, and classifiers as pure functions where practical.
- Inject clocks, IDs, storage, models, Sandbox, database, and providers through narrow interfaces.
- Keep application composition in application entry points.
- Require explicit timeout and cancellation signals for every network or provider operation.
- Use idempotency keys for every expensive or externally mutating operation.
- Use transactions for state changes that reserve quota or create durable jobs.

### Configuration and secrets

- Centralize environment parsing and validated configuration.
- Do not read process environment variables throughout business logic.
- Never commit credentials, generated environment files, database URLs, signed URLs, or provider
  tokens.
- Redact credentials and source content in structured logs and errors.
- Record configuration, policy, handler, model, adapter, and prompt-template versions with every
  deployment.

### Maintainability

- Prefer small cohesive modules and named domain concepts over generic utility collections.
- Keep provider SDK imports inside provider adapter directories.
- Do not create empty abstraction packages in anticipation of hypothetical use.
- Extract a shared abstraction only after at least two real handlers need it.
- Keep old static contracts and handlers working while adding new versioned lanes.
- Use additive migrations and expand/contract database changes.
- Document every shared-contract change and its consumers in the pull request.

### Observability

Structured events should include:

- Correlation, workspace, app, version, deployment, job, and attempt IDs.
- Handler, policy, model, adapter, and provider version.
- State transition and safe reason code.
- Artifact and diff hashes.
- Sandbox, AI, hosting, database, storage, and bandwidth usage.
- Suspension, deletion, promotion, rollback, and cleanup actions.

Logs must not contain full source, archive contents, credentials, database URLs, signed URLs, or
unbounded raw provider output.

### Code review requirements

Every implementation pull request should report:

- Story and supported workload lane.
- Contract and migration impact.
- Security and threat-model impact.
- Customer and provider cost impact.
- Idempotency, cancellation, cleanup, and rollback behavior.
- Tests and fixtures run.
- Secrets or external resources required.
- Feature flag and rollout stage.
- Handoff information for shared boundaries.

## Testing and verification strategy

### Required pull-request checks

- pnpm check.
- pnpm build.
- Contract serialization and backward-compatibility tests.
- Deterministic policy unit tests.
- Workflow tests using provider fakes.
- Architecture dependency-boundary checks.
- Tests for the changed workload fixtures.
- Confirmation that tests do not require production credentials.

### Provider contract suites

Every implementation of execution, deployment, hosting-project, relational-database, object
storage, Queue, and secret-binding interfaces should pass a shared behavior suite:

- Create and cleanup are idempotent.
- Duplicate requests do not duplicate resources.
- Timeout and cancellation work.
- Output and errors are bounded and sanitized.
- Partial creation has a compensating cleanup path.
- Provider types do not escape the adapter.
- Usage is recorded once.

### Fixture matrix

Maintain versioned sample projects for:

- React/Vite, Vue, Svelte, and later Next.js happy paths.
- Nested roots and monorepos.
- Wrong scripts and output directories.
- Dependency and lockfile conflicts.
- Case-sensitive import failures.
- Localhost API references.
- Required public and private environment variables.
- Prisma and Drizzle with safe additive migrations.
- Separate frontend and API topology.
- Unsupported persistent workers, WebSockets, and durable local-disk assumptions.
- Malicious lifecycle scripts.
- Prompt injection inside repository text.
- Egress and SSRF attempts.
- Secret-bearing files.
- Infinite processes and excessive output.
- Failed and destructive migrations.

Each fixture declares its expected inventory, plan, deterministic repairs, AI eligibility,
validation, resource plan, and terminal result.

### Workflow resilience

Inject a failure after every durable checkpoint and verify:

- A later invocation resumes correctly.
- Duplicate Queue delivery is harmless.
- Sandboxes and preview databases are cleaned up.
- Provider resources are not duplicated.
- AI and provider usage are not double-counted.
- Cancellation prevents promotion.
- A failed release never becomes customer-visible.
- Rollback selects the prior immutable release.

### AI evaluation

Pull-request tests use deterministic mocked model responses and never assert exact prose from a
live model.

A scheduled evaluation suite should measure:

- Build-success improvement.
- End-to-end runtime success.
- Existing-test preservation.
- Changed-file count and risk.
- Unsupported-project classification accuracy.
- Secret and protected-path policy compliance.
- Average tokens, cost, iterations, and duration.
- Regression against previously successful repairs.

Live-model and live-provider tests use dedicated preview accounts and disposable resources, not
production projects.

### Release gate for each workload lane

A lane may graduate only when:

- Happy-path and common-repair fixtures pass.
- Hostile fixtures fail safely.
- Resume, cleanup, promotion, and rollback tests pass.
- A live canary deploys and rolls back.
- Success rate, latency, and cost remain within declared budgets.
- Customer-visible limitations and required inputs are documented.

## Rollout strategy

Each workload is controlled independently by server-side flags:

1. **Detection only:** produce a project and resource plan without execution.
2. **Internal fixtures:** run deterministic builds using team-owned projects.
3. **Invite-only preview:** enable selected workspaces with strict concurrency and spend limits.
4. **Deterministic public lane:** accept supported clean projects without broad AI repair.
5. **AI repair canary:** enable a small share of projects with conservative budgets.
6. **Broader availability:** expand only after measured reliability.

Flags should support workload, framework, model, provider, workspace, environment, and global
disablement. The current static lane must remain independently available during Vite and Next.js
rollout.

## Cost allocation and plans

Record usage per workspace, app, version, deployment, and attempt:

- Upload, repaired artifact, and release bytes.
- Sandbox creations, processor time, memory time, duration, and network transfer.
- AI model, input tokens, output tokens, and billed or estimated cost.
- Vercel build, Function, bandwidth, and project usage.
- Neon compute, storage, branching, transfer, and backup usage.
- Blob storage and transfer.
- Queue, email, scanner, and other integration usage when introduced.

Before managed full-stack launch:

- Run on a commercial provider plan suitable for the product.
- Reserve spend before creating persistent resources.
- Enforce project, build-minute, AI, database, storage, and bandwidth limits.
- Suspend or require plan action before a hard limit is exceeded.
- Reconcile provider usage and orphaned resources.
- Make deletion and retention behavior explicit.

Customer-facing billing may arrive later, but internal metering and spend protection cannot.

## Customer example

Suppose a customer uploads:

    my-app/
      client/
        package.json
        src/
      server/
        package.json
        src/
      prisma/
        schema.prisma
        migrations/
      .env.example

PocketCloud should:

1. Preserve the ZIP and create a working revision.
2. Detect a React frontend, Node API, Prisma, and Postgres requirement.
3. Show a plan for two components and one database.
4. Ask the customer for missing secret values through the trusted UI.
5. Build both components in a secret-free Sandbox.
6. Repair deployment configuration and source problems in the working revision.
7. Create a temporary Neon preview and apply migrations.
8. Start the API against the preview database.
9. Run API and browser checks.
10. Show the exact repair and resource summary.
11. After approval, create or reuse the app's hosting and production database resources.
12. Deploy a preview, verify it, and promote the production domain.
13. Store provider IDs, status, costs, and artifact references in PocketCloud's control database.
14. Destroy the Sandbox and temporary preview resources.

If the repository instead requires a persistent WebSocket server and Docker Compose, PocketCloud
should mark it unsupported for the current lane rather than pretending a build-only repair solved
the runtime requirement.

## Recommended implementation sequence

### Foundation

1. Correct the Sandbox trust boundary so all executable processing happens inside it.
2. Introduce versioned ProjectInventory, ApplicationPlan, RepairPlan, ValidationReport,
   ResourcePlan, and ReleaseManifest contracts.
3. Add resumable generic workflow stages and workload-handler registration.
4. Expand explicit execution capabilities for registry access, approved commands, private
   servers, bounded output, cancellation, and cleanup.
5. Add architecture dependency checks and provider contract suites.

### React and Vite alpha

1. Detect one Vite application and its lockfile.
2. Run a frozen dependency install in Sandbox.
3. Build and retrieve dist.
4. Add deterministic Vite repairs.
5. Add bounded build-log-driven AI repair with checkpoints.
6. Add browser verification and Vite fixture matrix.
7. Deploy through the existing static artifact path.

### Next.js full-stack lane

1. Add Next.js inventory and workload handler.
2. Create one isolated Vercel project per app.
3. Add trusted secret-name collection and opaque binding.
4. Deploy and verify pages, Functions, and routes.
5. Add immutable release promotion and rollback.

### Managed Neon lane

1. Add a separate customer-resource provisioning package.
2. Implement project-per-app Neon provisioning and scoped roles.
3. Add temporary migration branches and TTL cleanup.
4. Support Prisma and Drizzle additive migrations.
5. Add backup, recovery, destructive-change approval, metering, and deletion.

### Multi-service and broader runtimes

1. Add separate Node frontend/API route plans.
2. Add Blob, cron, and Queue resources only when required.
3. Add selected Python/FastAPI support.
4. Evaluate Vercel Services when mature and available.
5. Add a container/provider adapter for workloads that do not fit serverless execution.

## Decisions made by this document

- PocketCloud expands through explicit workload lanes rather than universal ZIP support.
- React/Vite is the next implementation lane.
- Next.js with optional Neon is the first full-stack lane.
- AI may edit real code only in a checkpointed derived revision.
- AI is limited by time, risk, token, and dollar budgets rather than primarily a small edit count.
- Builds, tests, runtime behavior, and deterministic policy remain authoritative.
- One Vercel project per full-stack customer application is the target isolation model.
- PocketCloud and customer application databases remain separate.
- One Neon project per managed customer application is the preferred long-term database model.
- Preview database branches are temporary and do not automatically receive production data.
- Resource creation requires trusted policy, customer approval when material, idempotency, usage
  reservation, and cleanup.
- PocketCloud remains a modular monolith with provider-neutral contracts and adapters.
- Vercel remains the first provider, but unsupported workloads may require a later provider.
- Security scanners that require outside software or services remain explicit future TODOs.

## Decisions still required before implementation

- Which Vite framework variants graduate with React.
- Whether early full-stack beta requires customer-supplied databases or includes managed Neon.
- Managed versus bring-your-own hosting for the first full-stack customers.
- Repair budgets and customer-visible AI pricing.
- Which source changes require customer approval before deployment.
- Retention periods for original, repaired, diagnostic, and release artifacts.
- Backup and recovery objectives for managed customer databases.
- Supported Node, package-manager, and framework version windows.
- The provider for persistent containers and background workers.
- Geographic region and data-residency rules.
- Ownership and licensing terms for AI-repaired source.
- Abuse reporting and takedown operations.

## Success measures

- Project-type and component-detection accuracy.
- Clean-project build and deployment success.
- AI-assisted end-to-end success improvement.
- Existing-test regression rate.
- Customer-intervention and unsupported rates.
- p50 and p95 deployment time.
- Sandbox, AI, hosting, database, and storage cost per release.
- Rollback and failed-promotion rate.
- Orphaned-resource count.
- Secret, protected-path, and cross-tenant policy violations.
- Cleanup success and preview-resource expiration.
- Customer download or acceptance of repaired source.

## References

Vendor behavior, models, limits, beta status, and pricing change. Recheck these sources before each
implementation lane or public launch:

- [Vercel Sandbox](https://vercel.com/docs/sandbox)
- [Vercel Sandbox network filtering](https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox)
- [Vercel deployments](https://vercel.com/docs/deployments/overview)
- [Vercel Build Output API](https://vercel.com/docs/build-output-api)
- [Vercel for Platforms](https://vercel.com/platforms)
- [Vercel Services](https://vercel.com/docs/services)
- [Vercel Functions runtimes](https://vercel.com/docs/functions/runtimes)
- [Vercel limits](https://vercel.com/docs/limits)
- [Neon projects](https://neon.com/docs/manage/projects)
- [Neon branching](https://neon.com/docs/introduction/branching)
- [Neon multitenancy](https://neon.com/docs/guides/multitenancy)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

Related PocketCloud documents:

- [System architecture](01-system-architecture.md)
- [Upload and deployment pipeline](02-upload-and-deployment-pipeline.md)
- [Security model](03-security-model.md)
- [Data and storage](04-data-and-storage.md)
- [Rate limiting and scaling](05-rate-limiting-and-scaling.md)
- [MVP and roadmap](06-mvp-and-roadmap.md)
- [Costs and operations](07-costs-and-operations.md)
- [Decision log and TODOs](08-decisions-and-todos.md)
- [Shared contracts](11-shared-contracts.md)
