# System Architecture

## Architectural approach

PocketCloud begins as a modular monolith in a TypeScript monorepo.

"Modular monolith" means the product is developed and released as one coordinated system, while responsibilities are separated cleanly enough to become independent services later if real scale requires it. The MVP does not need the operational cost of microservices.

## System overview

```text
Customer
   |
   v
Web dashboard
   |
   v
API / control plane -----> Neon PostgreSQL
   |                              |
   |                              +-- apps, versions, deployments
   |                              +-- job and usage records
   |
   +---------------------> Private object storage
   |                              +-- original ZIP
   |                              +-- normalized artifact
   |
   v
Background worker
   |
   +---> Vercel Sandbox
   |       +-- extract
   |       +-- inspect
   |       +-- normalize
   |       +-- validate or build
   |
   +---> AI provider
   |       +-- proposed patches only
   |
   +---> Deployment provider
           +-- Vercel first
           +-- other providers later
```

## Monorepo layout

```text
PocketCloud/
├── apps/
│   ├── web/
│   │   ├── src/app/                 # Pages and routes
│   │   ├── src/components/          # Customer-facing interface
│   │   └── src/lib/                 # API client and view helpers
│   ├── api/
│   │   ├── src/routes/              # Upload, app, and deployment endpoints
│   │   ├── src/services/            # Application-level orchestration
│   │   └── src/auth/                # Identity boundary when added
│   └── worker/
│       ├── src/jobs/                # Job consumers
│       ├── src/workflows/           # Deployment workflow
│       └── src/telemetry/           # Operational events
├── packages/
│   ├── core/
│   │   ├── src/domain/              # App, version, deployment, usage types
│   │   ├── src/archive/             # Safe archive policy
│   │   ├── src/analyzer/            # Project classification
│   │   ├── src/validators/          # Pre- and post-normalization checks
│   │   ├── src/policies/            # Size, type, and resource rules
│   │   └── src/errors/              # Stable customer-safe error taxonomy
│   ├── normalizer/
│   │   ├── src/deterministic/       # Known transformations
│   │   ├── src/ai/                  # Prompting and structured patch requests
│   │   ├── src/patches/             # Safe patch validation and application
│   │   └── src/change-log/          # Explainable repair records
│   ├── execution/
│   │   ├── src/provider.ts          # Execution environment interface
│   │   ├── src/vercel-sandbox/      # Production implementation
│   │   └── src/local/               # Development-only implementation
│   ├── deployment/
│   │   ├── src/provider.ts          # Deployment interface
│   │   └── src/vercel/              # Vercel SDK/API adapter
│   ├── platform/
│   │   ├── src/database/            # PostgreSQL repositories
│   │   ├── src/storage/             # Object storage adapter
│   │   ├── src/queue/               # Job-delivery adapter
│   │   └── src/logging/             # Structured logging
│   └── config/                       # Shared TypeScript and test configuration
├── tests/
│   ├── integration/
│   └── sample-apps/
└── docs/
```

Folders should be added only when implemented. This is a destination map, not a requirement to create empty directories during the first commit.

## Application responsibilities

### Web dashboard

The web application owns customer presentation:

- Upload interface
- App and deployment history
- Progress display
- Change summary
- Final link
- Customer-safe errors
- Team access and billing screens later

It does not extract archives, call AI providers, hold deployment credentials, or poll Vercel directly.

### API control plane

The API owns synchronous product operations:

- Validate the upload request envelope
- Create app, version, and deployment records
- Issue a private storage upload target
- Enforce customer quotas
- Enqueue deployment work
- Return a deployment ID immediately
- Return current status and events
- Authorize customer actions when identity is introduced

The API should not hold an HTTP request open through normalization and deployment.

### Background worker

The worker owns long-running orchestration:

- Claim one deployment job idempotently
- Create and configure a temporary Sandbox
- Retrieve the quarantined input
- Perform safe extraction and project analysis
- Run deterministic normalization
- Request and apply an AI patch when allowed
- Validate normalized output
- Invoke the deployment provider
- Monitor provider status
- Perform a final HTTP smoke check
- Record events, usage, and terminal state
- Stop the Sandbox in a `finally`-equivalent cleanup path

### Core package

Core contains vendor-neutral product rules. It should not import the Vercel, Neon, Blob, or AI SDKs.

Examples include:

- Deployment state machine
- Archive limits
- Supported file policy
- Static-site validity
- Project classification
- Stable error codes
- Usage and plan policy types

### Normalizer package

The normalizer converts a project into a known contract.

For static projects it handles:

- Finding a site nested one directory below the archive root
- Moving the actual site into a canonical output directory
- Correcting unambiguous filename-capitalization mismatches
- Identifying missing referenced assets
- Identifying local absolute paths and `localhost` references
- Removing known irrelevant metadata from the normalized output
- Producing a structured list of changes

Deterministic transformations run first. AI receives a limited project manifest and selected text files only when unresolved issues remain.

### Execution package

Execution is responsible for an isolated workspace. Its internal contract should remain small:

```ts
interface ExecutionProvider {
  create(options: ExecutionOptions): Promise<ExecutionEnvironment>;
  writeFiles(environmentId: string, files: InputFile[]): Promise<void>;
  run(environmentId: string, command: Command): Promise<CommandResult>;
  readFiles(environmentId: string, paths: string[]): Promise<OutputFile[]>;
  stop(environmentId: string): Promise<void>;
}
```

Vercel Sandbox is the first implementation. Static uploads still use the Sandbox for isolated extraction and normalization even though they do not execute a build command.

### Deployment package

Deployment translates an approved artifact into a provider-specific deployment:

```ts
interface DeploymentProvider {
  deploy(input: DeployableArtifact): Promise<ProviderDeployment>;
  getStatus(providerDeploymentId: string): Promise<ProviderStatus>;
  getLogs(providerDeploymentId: string): Promise<ProviderLog[]>;
  cancel(providerDeploymentId: string): Promise<void>;
  remove(providerDeploymentId: string): Promise<void>;
}
```

The interface should not attempt to represent every possible cloud capability. Add capabilities only when PocketCloud supports a workload that requires them.

## Project plan contract

Every upload is translated into a `ProjectPlan`. This is the common language between analysis, normalization, execution, and deployment.

Example static plan:

```json
{
  "kind": "static",
  "runtime": null,
  "framework": null,
  "installCommand": null,
  "buildCommand": null,
  "startCommand": null,
  "outputDirectory": ".",
  "requiredEnvironmentVariables": [],
  "deploymentProvider": "vercel"
}
```

Example future Vite plan:

```json
{
  "kind": "buildable_frontend",
  "runtime": "node22",
  "framework": "vite",
  "installCommand": ["npm", "ci"],
  "buildCommand": ["npm", "run", "build"],
  "startCommand": null,
  "outputDirectory": "dist",
  "requiredEnvironmentVariables": [],
  "deploymentProvider": "vercel"
}
```

Only validated command arrays may be executed. AI may propose a plan, but deterministic policy must approve it.

## Two processing paths

Every upload uses a Sandbox, but not every upload runs code.

### Static path

```text
Sandbox
  -> safe extraction
  -> deterministic inspection and normalization
  -> optional AI patch
  -> static validation
  -> retrieve normalized files
  -> deploy
```

### Build-required path

```text
Sandbox
  -> safe extraction
  -> detect runtime and framework
  -> permit only required package-network access
  -> install dependencies
  -> disable network again
  -> build and test
  -> optional AI repair
  -> rebuild within retry budget
  -> retrieve deployable artifact
  -> deploy
```

The build-required path is post-MVP but uses the same outer workflow.

## Trust boundaries

PocketCloud has three meaningful trust zones:

1. **Trusted control plane:** dashboard, API, database, worker orchestration, provider credentials.
2. **Untrusted processing zone:** one Sandbox per upload, no production secrets, default-deny network, strict resources.
3. **Untrusted published zone:** customer applications on a separate registrable domain with no dashboard cookies or platform credentials.

Files move from an untrusted zone to a trusted operation only as bytes through a validated interface. Commands and credentials never move in the opposite direction without explicit policy.

## Scaling philosophy

The first version scales by controlling concurrency, not by creating many services. PostgreSQL remains the system of record. Object storage holds artifacts. A job boundary separates HTTP traffic from deployment work. Redis, managed queues, independent worker pools, and additional providers are introduced only in response to real load or reliability requirements.

## Relevant vendor references

- [Vercel Sandbox](https://vercel.com/docs/sandbox)
- [Vercel deployments](https://vercel.com/docs/deployments/overview)
- [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
