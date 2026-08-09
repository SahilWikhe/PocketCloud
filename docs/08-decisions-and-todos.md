# Decision Log and TODOs

This document records decisions reached during initial product and architecture planning. It is intentionally explicit so later implementation does not reopen settled questions accidentally.

## Accepted decisions

### D-001: Use a monorepo

**Decision:** Dashboard, API, worker, and shared packages live in one repository.

**Reason:** The team can move quickly, share types and validation, and maintain clear boundaries without microservice overhead.

### D-002: Begin as a modular monolith

**Decision:** Separate responsibilities in code and deployable apps, but do not create a network service for every package.

**Reason:** The MVP needs simplicity. Queues and provider adapters preserve future scaling options.

### D-003: Static projects are the first supported class

**Decision:** The MVP accepts only static HTML, CSS, JavaScript, JSON, images, and fonts.

**Reason:** It proves the customer promise while avoiding dependency installation, framework builds, backend runtimes, databases, and secrets.

### D-004: Include AI normalization from the beginning

**Decision:** The MVP has one narrow AI patch capability.

**Reason:** Normalization and repair are central to the intended product differentiation, even when initial projects are static.

### D-005: Deterministic rules precede AI

**Decision:** Known transformations are regular code; AI handles unresolved interpretation only.

**Reason:** This is faster, cheaper, reproducible, and easier to explain.

### D-006: Preserve the original upload

**Decision:** Original, working, and normalized artifacts are distinct.

**Reason:** Enables traceability, explanation, reproducibility, and future rollback.

### D-007: Use a Sandbox for every upload

**Decision:** Static uploads also pass through Vercel Sandbox.

**Reason:** PocketCloud accepts unknown code. Isolating extraction and normalization establishes the correct trust boundary before framework execution is introduced.

### D-008: Vercel is the first execution and deployment provider

**Decision:** Use Vercel Sandbox for isolated processing and Vercel Deployments for the permanent URL.

**Reason:** It minimizes initial infrastructure while supporting the intended future repair loop.

### D-009: Keep provider-specific behavior behind adapters

**Decision:** Execution and deployment depend on small internal interfaces.

**Reason:** Future Node, Python, Docker, or long-running services may require another provider.

### D-010: Use Neon PostgreSQL

**Decision:** PostgreSQL is the system of record, initially hosted by Neon.

**Reason:** Durable relational data, transactions, standard SQL, serverless pooling, and an inexpensive start.

### D-011: Store files in object storage

**Decision:** Original and normalized file bytes live in private object storage, initially Vercel Blob or an equivalent adapter.

**Reason:** PostgreSQL should store metadata and relationships, not archive bytes.

### D-012: PostgreSQL handles initial job and usage records

**Decision:** Avoid Redis and a separate queue for the first implementation.

**Reason:** PostgreSQL is sufficient for low-volume durable quotas and job claims. Add Redis and managed queue delivery in response to measured need.

### D-013: Security is defense in depth

**Decision:** Implement quarantine, Sandbox isolation, archive policy, file allowlist, no secrets, network restrictions, domain isolation, browser policy, rate limits, and kill switch in the MVP.

**Reason:** A Sandbox protects infrastructure but does not by itself protect visitors or prevent abuse.

### D-014: Third-party security scanning is deferred explicitly

**Decision:** Antivirus, malware reputation, dependency scanning, behavioral analysis, and commercial scanners are TODOs.

**Reason:** The initial request is to implement code-level security first and integrate outside security engines later.

### D-015: Do not claim malware safety without scanning

**Decision:** Use `PLATFORM_CHECKS_PASSED`; never use `VIRUS_FREE` or `MALWARE_SCAN_PASSED` in the MVP.

**Reason:** Deterministic checks and isolation cannot prove that arbitrary JavaScript or files are benign.

### D-016: Public links are acceptable for the prototype

**Decision:** Private team access is deferred, but uploaded apps must remain isolated from the trusted dashboard origin.

**Reason:** Full access control is a later product layer. Origin isolation prevents the public prototype from creating an architectural trap.

### D-017: Use two stable implementation lanes

**Decision:** Builder A owns the control plane and Builder B owns the execution plane, with integration through shared contracts.

**Reason:** Stable path ownership lets two people and their Codex sessions work in parallel without repeatedly editing the same files or inventing incompatible internal models.

### D-018: Markdown defines the backlog; GitHub tracks live work

**Decision:** Repository documentation defines stories, dependencies, and acceptance criteria. GitHub Issues and pull requests record assignment and current status.

**Reason:** Both builders updating one Markdown status table would itself create unnecessary merge conflicts. Issues provide independent claim and discussion records for each story.

## Open product decisions

- Final product and company name availability
- Initial customer segment and whether the prototype is invite-only
- Authentication provider and timing
- Public app policy before team access exists
- Default Content Security Policy and external-domain request process
- Original and normalized artifact retention periods
- Free and paid plan limits
- Whether customers can download normalized output
- Whether AI changes require customer approval before deployment
- Customer ownership and licensing terms for repaired code
- Abuse-reporting and takedown policy
- Geographic region and data-residency requirements

## Engineering TODOs for MVP

- TODO: Initialize the TypeScript workspace and package manager
- TODO: Define domain types and deployment state machine
- TODO: Create Neon database and migrations
- TODO: Add private object-storage adapter
- TODO: Implement direct upload and artifact hashing
- TODO: Implement idempotent deployment creation
- TODO: Implement PostgreSQL job claim and heartbeat
- TODO: Implement Vercel Sandbox adapter
- TODO: Enforce default-deny Sandbox network policy
- TODO: Implement safe ZIP extraction budgets
- TODO: Implement static file allowlist and content checks
- TODO: Implement static project-root analyzer
- TODO: Implement deterministic normalizer
- TODO: Implement structured AI patch schema and validator
- TODO: Implement final normalized artifact manifest
- TODO: Implement Vercel deployment adapter
- TODO: Implement provider status mapping and logs
- TODO: Implement final HTTP verification
- TODO: Implement progress polling and customer-safe errors
- TODO: Implement operator suspension and cleanup
- TODO: Create hostile and broken sample-app fixtures
- TODO: Add end-to-end tests for happy and failure paths
- TODO: Configure spend and rate-limit controls

## Security integration TODOs after MVP

- TODO: Antivirus scanner such as ClamAV
- TODO: Known-malware hash and reputation service
- TODO: Dependency vulnerability scanner
- TODO: Supply-chain and lockfile scanning
- TODO: Advanced secret-scanning engine
- TODO: Phishing detection
- TODO: Malicious JavaScript static analysis
- TODO: Headless-browser behavioral monitoring
- TODO: SAST for supported frameworks
- TODO: Container-image vulnerability scanning
- TODO: Human review queue
- TODO: Formal abuse-reporting and takedown system

## Expansion TODOs

### Buildable frontends

- TODO: Vite detection and build plan
- TODO: Controlled package-registry access
- TODO: Lockfile-aware dependency install
- TODO: Build output retrieval from `dist`
- TODO: Build-log-driven repair with strict retry budget
- TODO: React, Vue, and Svelte fixtures

### Full-stack projects

- TODO: Next.js deployment contract
- TODO: Environment-variable discovery and customer collection
- TODO: Secret storage and injection without exposing values to AI
- TODO: Runtime logs and health checks

### General runtimes

- TODO: Node service contract
- TODO: Python/FastAPI contract
- TODO: Docker or OCI build contract
- TODO: Provider-selection policy
- TODO: Additional deployment provider adapter

### Product platform

- TODO: Authentication
- TODO: Organizations, roles, and permissions
- TODO: Private access gateway
- TODO: Custom domains
- TODO: Version history and rollback
- TODO: Provisioned customer databases and storage
- TODO: Billing and plan enforcement
- TODO: Monitoring, runtime logs, and alerts

## Sources to recheck before implementation

- [Vercel Sandbox documentation](https://vercel.com/docs/sandbox)
- [Vercel deployment documentation](https://vercel.com/docs/deployments/overview)
- [Vercel limits](https://vercel.com/docs/limits)
- [Vercel pricing](https://vercel.com/pricing)
- [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
- [Vercel Queues](https://vercel.com/docs/queues)
- [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage)
- [Neon pricing](https://neon.com/pricing)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [OpenAI prepaid billing](https://help.openai.com/en/articles/8264778-what-is-prepaid-billing)

Vendor versions, limits, plan terms, and prices are time-sensitive. This decision record captures the architecture as of August 9, 2026.
