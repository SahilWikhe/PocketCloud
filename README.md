# PocketCloud

PocketCloud is a deployment platform for small, AI-generated applications. Its goal is to make publishing an app feel as simple as sharing a document: upload a project, let PocketCloud understand and repair it, and receive a working link without learning cloud infrastructure.

> Current status: the control plane, execution plane, `PC-301` end-to-end composition, and
> `PC-302` customer presentation matrix are implemented. `PC-304` packages the UI, API, durable
> queue consumer, and retention job for one Vercel project. `PC-401` adds the public landing page,
> Clerk customer accounts, personal Neon workspaces, and an authenticated project/deployment
> dashboard. `PC-402` adds audited redeploy, suspend, restore, and recoverable-delete controls.
> `PC-303` billing-owner confirmations and approved live provider tests remain mandatory
> pilot gates.

## Product promise

```text
Upload an app
    -> PocketCloud understands it
    -> PocketCloud fixes deployment problems
    -> PocketCloud validates it in isolation
    -> PocketCloud deploys it
    -> The customer receives a shareable link
```

The first MVP supports static HTML, CSS, and JavaScript projects uploaded as ZIP files. The architecture deliberately prepares for Vite, React, Vue, Svelte, Next.js, Node, Python, Docker, databases, environment variables, and multiple deployment providers without attempting to build all of those capabilities immediately.

## Current architectural decisions

- Use a TypeScript monorepo organized as a modular monolith.
- Keep the dashboard, API, and worker as separate applications within the monorepo while hosting
  them as static assets and bounded Vercel Functions for the MVP.
- Process every upload in a temporary Vercel Sandbox, including static sites.
- Keep the original upload immutable and work only on copies.
- Apply deterministic repairs before requesting an AI repair.
- Allow one narrow AI normalization attempt in the MVP.
- Use Vercel as the first deployment provider, behind a small provider interface.
- Use Neon-hosted PostgreSQL as the platform database.
- Use private object storage, initially Vercel Blob, for uploaded and normalized artifacts.
- Use PostgreSQL as the job and durable usage system of record. Use Vercel Queues to wake bounded,
  resumable worker Functions; add Redis only when measured traffic requires it.
- Implement strong code-level safety controls now. Treat antivirus, malware reputation, dependency scanners, and other third-party security engines as explicit future TODOs.
- Never describe an upload as malware-free until a real malware scanner has run. The MVP status is `PLATFORM_CHECKS_PASSED`.

## Proposed repository structure

```text
PocketCloud/
├── apps/
│   ├── web/                  # Customer dashboard
│   ├── api/                  # Product control plane
│   └── worker/               # Upload, normalization, and deployment orchestration
├── packages/
│   ├── core/                 # Domain rules and deterministic validation
│   ├── normalizer/           # Deterministic and AI-assisted repairs
│   ├── execution/            # Isolated execution provider; Vercel Sandbox first
│   ├── deployment/           # Deployment provider; Vercel first
│   ├── platform/             # Database, object storage, queue, and logging adapters
│   └── config/               # Shared TypeScript and tooling configuration
├── tests/
│   └── sample-apps/          # Known-good, broken, and hostile test fixtures
└── docs/                     # Product and engineering handbook
```

Only create packages when they contain real code. The boundaries above guide the MVP; they are not a request to build empty abstractions.

## Development setup

PocketCloud uses Node.js 24 and pnpm workspaces. The exact pnpm version is recorded in
`package.json`, and `pnpm-lock.yaml` is the only dependency lockfile.

```text
pnpm install
cp .env.example .env
pnpm check
```

Useful commands:

```text
pnpm dev:api       # API on port 8787
pnpm dev:web       # dashboard on port 5173, proxying /v1 to the API
pnpm dev:worker    # Builder B's worker shell
pnpm --filter @pocketcloud/platform db:migrate
pnpm check         # lint, all type checks, and all tests
pnpm build         # production web build and workspace build checks
pnpm build:vercel  # production UI plus bundled Vercel Function entry points
```

`DATABASE_URL` must be a pooled Neon PostgreSQL connection string. Vercel Blob must be a
private store. Hosted production verifies Clerk sessions and maps each customer to a durable Neon
workspace. The API's hashed prototype actor exists only for local/test compositions that do not
install the production identity provider.

The control plane accepts, quarantines, and queues an upload. On Vercel, a private Queue-triggered
Function claims that exact durable job, connects the public platform and execution interfaces, and
records the verified result so a reconnected dashboard can display the live URL. Production
startup requires the trusted-host Vercel, Blob, and Neon credentials documented in `.env.example`;
none are copied into a Sandbox. The standalone worker command remains available for local use.

## Documentation map

1. [Product brief](docs/00-product-brief.md)
2. [System architecture](docs/01-system-architecture.md)
3. [Upload and deployment pipeline](docs/02-upload-and-deployment-pipeline.md)
4. [Security model](docs/03-security-model.md)
5. [Data and storage model](docs/04-data-and-storage.md)
6. [Rate limiting and scaling](docs/05-rate-limiting-and-scaling.md)
7. [MVP scope and roadmap](docs/06-mvp-and-roadmap.md)
8. [Costs and operating assumptions](docs/07-costs-and-operations.md)
9. [Decision log and TODOs](docs/08-decisions-and-todos.md)
10. [Parallel development plan](docs/09-parallel-development.md)
11. [MVP user stories](docs/10-user-stories.md)
12. [Shared workstream contracts](docs/11-shared-contracts.md)
13. [Codex session and handoff guide](docs/12-agent-handoffs.md)
14. [Builder A implementation handoff](docs/13-builder-a-handoff.md)
15. [Builder B execution-plane handoff](docs/14-builder-b-handoff.md)
16. [Customer success and failure matrix](docs/15-customer-failure-matrix.md)
17. [Controlled pilot readiness](docs/16-pilot-readiness.md)
18. [PC-304 Vercel control-plane handoff](docs/17-pc-304-vercel-control-plane.md)
19. [PC-401 accounts and dashboard handoff](docs/19-pc-401-accounts-dashboard.md)

Codex and other AI coding agents must also follow the repository-wide instructions in [AGENTS.md](AGENTS.md).

## Initial customer experience

The customer should see understandable progress rather than infrastructure terminology:

```text
Upload received
Checking your project
Fixing two issues
Preparing deployment
Publishing
Your app is ready
```

For small static applications, the product target is usually under one minute from upload to live link. This is a target rather than an SLA because upload speed, AI response time, file count, and Vercel deployment time vary.

## MVP definition

The first release is a controlled prototype, not a universal cloud platform. It accepts a small static-site ZIP, processes it in isolation, applies deterministic and optionally AI-assisted normalization, deploys only the approved normalized output, and returns a public URL.

The current product includes real customer accounts and personal workspaces. It still excludes
payments, private team sharing, custom domains, databases for uploaded apps, framework builds,
backend runtimes, and multiple cloud providers. The interfaces and data model leave room for those
additions.

## Source date

This architecture was consolidated on August 9, 2026. Vendor behavior and pricing should be rechecked before implementation or launch.
