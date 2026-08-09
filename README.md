# PocketCloud

PocketCloud is a deployment platform for small, AI-generated applications. Its goal is to make publishing an app feel as simple as sharing a document: upload a project, let PocketCloud understand and repair it, and receive a working link without learning cloud infrastructure.

> Current status: Builder A's control plane is implemented. The workspace, shared contracts,
> PostgreSQL data layer, private upload flow, lifecycle API, quotas, customer dashboard, and
> operator suspension controls are ready for integration with Builder B's execution plane.

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
- Run the dashboard, API, and background worker as separate applications within that monorepo.
- Process every upload in a temporary Vercel Sandbox, including static sites.
- Keep the original upload immutable and work only on copies.
- Apply deterministic repairs before requesting an AI repair.
- Allow one narrow AI normalization attempt in the MVP.
- Use Vercel as the first deployment provider, behind a small provider interface.
- Use Neon-hosted PostgreSQL as the platform database.
- Use private object storage, initially Vercel Blob, for uploaded and normalized artifacts.
- Use PostgreSQL as the initial job and durable usage record; add Redis and a managed queue when traffic justifies them.
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
```

`DATABASE_URL` must be a pooled Neon PostgreSQL connection string. Vercel Blob must be a
private store. The API hashes prototype actor identifiers before persistence; raw browser IDs
and source IPs are not used as durable customer identity.

The control plane can currently accept, quarantine, and queue an upload. It will not reach a
live URL until Builder B implements and connects the Sandbox, normalization, deployment, and
worker stories.

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

The MVP intentionally excludes accounts, payments, private team sharing, custom domains, databases for uploaded apps, framework builds, backend runtimes, and multiple cloud providers. The interfaces and data model leave room for those additions.

## Source date

This architecture was consolidated on August 9, 2026. Vendor behavior and pricing should be rechecked before implementation or launch.
