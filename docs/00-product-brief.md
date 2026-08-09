# Product Brief

## Problem

AI can generate a useful tracker, dashboard, internal tool, or small application in minutes. Publishing that application still requires knowledge of repositories, builds, environment variables, hosting providers, domains, access control, logs, and runtime configuration.

The gap is no longer primarily code generation. The gap is converting generated code into a reliable, shareable application.

## Product idea

PocketCloud is a cloud for small software. A customer uploads an app and receives a live link without needing to understand how it was built or where it runs.

The simplest analogy is a mailbox: the customer should be able to drop in their application and have PocketCloud deliver it without requiring them to operate the logistics network.

## Value proposition

PocketCloud should own deployment compatibility wherever it can do so responsibly. Asking the customer to repair package scripts, create Dockerfiles, select a runtime, or understand a cloud provider would reproduce the problem the product is meant to remove.

The intended experience is:

```text
Raw project
    -> Understand
    -> Normalize or repair
    -> Validate securely
    -> Deploy
    -> Operate and share
```

It is not merely:

```text
ZIP -> Vercel
```

## Target customers

Early customers are people and small teams who:

- Generate small applications with ChatGPT, Claude, Cursor, v0, Lovable, or similar tools.
- Have a useful project but do not want to learn deployment infrastructure.
- Need a disposable or team-specific application rather than a large software program.
- Value speed and understandable errors more than fine-grained infrastructure control.

Likely examples include:

- Team dashboards
- Trackers and calculators
- Lightweight operations tools
- Internal directories
- Simple reporting interfaces
- Small customer or partner portals
- One-purpose workflow applications

## Product principles

### Hide infrastructure, not reality

Customers should see "Fixing your project" rather than build logs, but PocketCloud must preserve detailed internal records and provide an understandable explanation when it cannot continue.

### Constrain before generalizing

The MVP solves one project class well. It does not claim to deploy arbitrary code. Each later project class receives a defined runtime and deployment contract.

### Preserve customer work

The original upload is immutable. Repairs occur on a working copy. Every meaningful change is recorded, making explanation, rollback, and future comparison possible.

### Deterministic first, AI second

Known problems should be solved by explicit rules. AI is reserved for cases that require interpretation. AI output is always treated as a proposed patch and validated before deployment.

### Isolate unknown code

Every upload is processed inside a disposable execution environment. Uploaded code never receives PocketCloud credentials or direct access to the platform database.

### Provider flexibility without premature multi-cloud work

Vercel is the first deployment provider. PocketCloud depends on a small internal deployment contract rather than spreading Vercel-specific behavior across the product.

## MVP customer promise

For the first release:

> Upload a small static website ZIP. PocketCloud checks its structure, fixes common deployment issues, and publishes the approved result to a live URL.

The MVP supports:

- HTML, CSS, client-side JavaScript, JSON, images, and fonts
- A required `index.html`, which may initially be nested one directory below the archive root
- Common path and capitalization repairs
- One AI-assisted normalization pass when rules are insufficient
- A public Vercel-hosted result
- Friendly status and failure messages

The MVP does not support:

- React, Vue, Svelte, Vite, or Next.js builds
- Node, Python, or other server processes
- Databases for customer applications
- Customer-provided secrets
- Private team access
- Custom domains
- Payments
- Multiple deployment providers
- A repeated autonomous AI repair loop

## Intended finished product

The long-term product adds five major capabilities:

1. **Project intelligence:** detect frameworks, runtimes, dependencies, ports, build commands, output directories, environment variables, and data requirements.
2. **Normalization and repair:** generate or correct configuration, repair build failures, and retry within strict budgets.
3. **Execution abstraction:** safely build and test projects in isolated environments.
4. **Deployment abstraction:** select a compatible provider for each workload.
5. **Application platform:** authentication, organizations, permissions, secrets, databases, domains, logs, sleep and wake, deletion, history, rollback, and billing.

The target customer experience becomes:

```text
Upload app
    -> "Detected React + Express + PostgreSQL"
    -> Customer supplies only information that cannot be inferred
    -> PocketCloud builds, repairs, provisions, and deploys
    -> inventory-tool.customer-app-domain.com
```

## Success indicators

MVP product metrics should focus on whether the core promise works:

- Percentage of accepted static uploads that reach a live URL
- Median upload-to-link time
- Percentage resolved without AI
- Percentage resolved with one AI attempt
- Clear failure rate versus unexplained failure rate
- Average AI cost per successful deployment
- Repeat deployment rate
- Number of reported or suspended applications

## Terminology

- **App:** the logical customer-owned application.
- **Version:** one immutable customer upload plus its derived normalized output.
- **Deployment:** one attempt to publish a version.
- **Artifact:** a stored file set such as the original ZIP or normalized output.
- **Normalization:** changing project structure or configuration into a known deployment contract.
- **Repair:** a change made to resolve a detected problem.
- **Sandbox:** an isolated temporary computer used to inspect or execute an upload.
- **Provider:** a replaceable integration such as Vercel for deployment or Neon for PostgreSQL hosting.
- **Platform checks:** PocketCloud's deterministic policy and validation checks; not equivalent to an antivirus verdict.
