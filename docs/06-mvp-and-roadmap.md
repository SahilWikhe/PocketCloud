# MVP Scope and Roadmap

## MVP objective

Prove the core customer promise:

> A customer can upload a small static website ZIP and receive a working public URL without understanding deployment infrastructure.

The MVP is successful when it demonstrates the complete pipeline, not when it supports every project type.

## MVP scope

### Included

- Static HTML, CSS, and client-side JavaScript
- ZIP upload with a 10 MB compressed limit
- Private quarantine storage
- Sandbox processing for every upload
- Safe extraction and deterministic policy checks
- Static project-root detection
- Canonical normalized output
- Common deterministic repairs
- One AI normalization attempt when necessary
- Change summary
- Final deterministic validation
- Vercel deployment through a provider adapter
- Customer-visible progress
- Public live URL
- Stable customer-safe errors
- Basic IP and actor quota
- Deployment kill switch
- PostgreSQL records for apps, versions, jobs, events, and usage

### Excluded

- Customer authentication and organizations
- Private app access
- Payments
- Custom domains
- Framework build commands
- Backend runtimes
- Databases or secrets for uploaded apps
- Multiple deployment providers
- Repeated AI build-repair loops
- Antivirus or third-party malware scanning
- Formal abuse operations
- Production SLA

## MVP acceptance criteria

### Happy path

- A valid static ZIP reaches a live HTTPS URL.
- `index.html` may be at the root or inside one unambiguous wrapper directory.
- Original and normalized artifacts have different immutable identities.
- The browser can leave and return while the job continues.
- The customer sees a concise progress history and final change summary.

### Failure path

- Unsafe archive paths are rejected without leaving the Sandbox.
- Oversized archives stop before exceeding extraction budgets.
- Missing entry points return a stable understandable error.
- Unsupported files are rejected before deployment.
- An AI timeout or invalid patch does not deploy partial output.
- A Vercel failure is recorded and surfaced without leaking credentials or raw internal state.
- The Sandbox is stopped after every terminal outcome.

### Operational path

- Duplicate submission with the same idempotency key does not create a duplicate deployment.
- Only one active deployment per prototype actor is allowed.
- Operators can suspend a deployed app.
- Usage events record upload bytes, AI usage, Sandbox duration, and deployment attempt.

## Delivery estimate

A bare static demonstration can fit into approximately 24 focused engineering hours if credentials and APIs work as expected. Processing every upload through a properly constrained Sandbox adds work; a tested security-conscious prototype is more realistically 30-36 hours.

Suggested implementation order:

| Work | Estimate |
|---|---:|
| Monorepo, domain types, and basic dashboard | 2-3 hours |
| PostgreSQL schema and deployment state | 2-3 hours |
| Direct private upload and artifact record | 2-3 hours |
| Vercel deployment proof: files to URL | 3-4 hours |
| Sandbox create, transfer, extract, and cleanup | 4-5 hours |
| Archive and file-policy validation | 3-4 hours |
| Deterministic static normalizer | 2-3 hours |
| One AI patch workflow | 2-3 hours |
| Progress UI and customer errors | 2-3 hours |
| Rate limits, kill switch, integration tests, and buffer | 4-5 hours |

The Vercel deployment proof should happen early. It validates the highest external integration risk before interface polish.

## Recommended implementation sequence

### Milestone 0: Walking skeleton

```text
Upload known-good folder
    -> deploy to Vercel
    -> return URL
```

No AI and minimal interface. Purpose: prove credentials and provider contract.

### Milestone 1: Durable control plane

Add PostgreSQL records, immutable app versions, deployment states, events, and idempotency.

### Milestone 2: Quarantine and Sandbox

Add private object storage, one Sandbox per upload, safe transfer, extraction limits, default-deny networking, and guaranteed cleanup.

### Milestone 3: Static normalization

Add project-root detection, deterministic fixes, normalized artifact creation, and post-normalization validation.

### Milestone 4: Narrow AI repair

Add one structured patch request, patch policy, change records, and final validation.

### Milestone 5: Customer experience

Add status polling, progress messages, final link, understandable errors, and operator suspension.

## Roadmap after the MVP

### Phase 2: Buildable frontends

Support, in order:

- Vite
- React
- Vue
- Svelte

These are a practical next step because they build into a static output directory such as `dist`.

Flow:

```text
Detect framework
    -> Sandbox permits package registry temporarily
    -> install dependencies
    -> disable network
    -> build
    -> retrieve dist
    -> deploy
```

First proof target:

```text
Upload Vite project
    -> build inside Vercel Sandbox
    -> retrieve dist/
    -> deploy to Vercel
```

### Phase 3: Vercel-compatible full-stack projects

- Next.js
- Serverless API routes
- Approved Node-based frameworks
- Environment-variable declaration and secure collection
- Build-log-driven AI repair with a bounded retry loop

### Phase 4: General application runtimes

- Express and long-running Node services
- Python and FastAPI
- Docker-based workloads
- Background processes
- Provider selection based on workload

Some workloads will not fit Vercel's serverless deployment model. The deployment interface allows PocketCloud to add another provider without changing the customer workflow.

### Phase 5: Application platform

- Customer accounts
- Organizations and roles
- Private apps
- Access gateway
- Secrets
- Provisioned databases and storage
- Custom domains
- Version history and rollback
- Logs and monitoring
- Sleep and wake
- Billing and plan enforcement
- Abuse reporting and security integrations

## Product performance target

For the static MVP:

- No AI: approximately 10-30 seconds
- One AI repair: approximately 20-50 seconds
- Retry or provider delay: approximately 45 seconds to 2 minutes

Customer-facing positioning:

> Most small apps are live in under a minute.

This is an initial product target, not an SLA.

## What must not be generalized prematurely

- Do not build a universal framework detector before the Vite path works.
- Do not create multiple deployment integrations before a workload requires one.
- Do not introduce Redis before PostgreSQL limits are measured.
- Do not create microservices merely to mirror future organization charts.
- Do not allow unlimited AI retries.
- Do not accept arbitrary commands proposed by AI.
- Do not mix PocketCloud's platform database with databases provisioned for customer apps.
