# Security Model

## Security position

PocketCloud accepts code it did not write. Isolation and policy enforcement are therefore part of the product's core architecture, not optional polish.

The MVP implements the strongest practical deterministic controls in PocketCloud code and through Vercel Sandbox configuration. Security engines that require separate third-party software or services are documented as TODOs and intentionally excluded from the first implementation.

Passing MVP checks means only:

```text
PLATFORM_CHECKS_PASSED
```

It must never be represented as:

```text
SAFE
VIRUS_FREE
MALWARE_SCAN_PASSED
```

until a real malware-scanning system has performed that check.

## Threat categories

### Threats to PocketCloud infrastructure

- Archive parser exploitation
- ZIP bombs and storage exhaustion
- Path traversal and file overwrite
- Uploaded commands reading platform secrets
- Network-based exfiltration
- Excessive CPU, memory, or execution time
- Attempts to access another customer's data
- Provider-token theft

### Threats to visitors

- Malicious browser JavaScript
- Phishing forms
- Redirects and popups
- Downloads containing executable malware
- Attempts to access trusted dashboard state
- Misleading or abusive content

### Threats to availability and cost

- Upload or deployment floods
- Infinite repair loops
- AI token abuse
- Sandbox creation abuse
- Provider rate-limit exhaustion
- Large outbound traffic

### Threats to customer data

- Accidental upload of `.env` files or private keys
- AI receiving unnecessary source or secrets
- Logs containing source code or credentials
- Public access to quarantined artifacts

## Trust zones

```text
Trusted control plane
  Dashboard, API, worker orchestration, database, credentials

Untrusted processing zone
  One temporary Sandbox per upload

Untrusted published zone
  Customer applications on a separate registrable domain
```

The control plane never executes uploaded code. The published zone never receives control-plane cookies or credentials.

The production deployment consumer is a private Vercel Queue Function with no public route. Queue
messages contain only a deployment ID and never contain source, signed storage URLs, or provider
credentials. Scheduled retention uses a separate endpoint authenticated with `CRON_SECRET` using a
constant-time comparison.

## Code-level controls implemented in the MVP

### Private quarantine

- Raw uploads are stored privately.
- Storage keys are generated internally.
- User filenames are metadata only and are never trusted as paths.
- Raw uploads receive no public URL.
- The original upload is immutable.
- Rejected or abandoned artifacts expire automatically.
- A cryptographic hash identifies the exact uploaded bytes.

### Archive safety

Initial policy values:

| Limit | MVP value |
|---|---:|
| Compressed ZIP | 10 MB |
| Expanded project | 50 MB |
| Files | 500 |
| Individual file | 10 MB |
| Directory depth | 12 |
| Nested archives | Rejected |
| Processing time | 2 minutes maximum |

Extraction must:

- Normalize and validate paths before writing.
- Reject absolute paths, traversal segments, drive prefixes, and control characters.
- Reject symbolic and hard links.
- Prevent aliases from overwriting an already extracted path.
- Stop immediately when a byte or file-count budget is exceeded.
- Extract only inside the assigned Sandbox working directory.

### File policy

The static MVP uses an allowlist. An illustrative initial list is:

```text
.html .css .js .mjs .json .txt
.png .jpg .jpeg .gif .webp .ico
.svg .woff .woff2
```

Policy also:

- Verifies content signatures for binary types where practical.
- Requires expected text formats to decode as text and rejects unexpected null bytes.
- Rejects executables, installers, shell scripts, server-executable formats, disk images, and unknown binaries.
- Rejects `.env`, common private-key files, credentials, and deployment-token files from normalized output.
- Re-checks the final normalized directory rather than trusting the input check.

File extensions or client-supplied MIME types alone are not sufficient.

### Sandbox isolation

Every upload, including a static site, is processed in a separate Vercel Sandbox.

Required configuration:

- Non-persistent environment
- No PocketCloud environment variables
- No database connection
- No object-storage credentials
- No AI key
- No Vercel deployment token
- Default-deny network policy
- No exposed ports for static MVP processing
- Strict timeout and resource limits
- Unique correlation tags
- Guaranteed cleanup on success, failure, and cancellation

Vercel documents Sandbox as a Firecracker microVM intended for untrusted user and AI-generated code. Network access must be configured explicitly; it should not be assumed to be denied by default. See [Vercel Sandbox](https://vercel.com/docs/sandbox) and [Sandbox network filtering](https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox).

### AI boundary

AI is untrusted assistance, not an authority.

- AI receives only selected policy-approved text files.
- Source size and token budgets are capped.
- Obvious secret-bearing files are excluded.
- AI returns structured proposed file operations.
- It cannot run commands, call providers, or access credentials.
- All patch paths and sizes are validated.
- The patch is applied only to a working copy in the Sandbox.
- Deterministic validation runs after the patch.
- Every accepted modification receives a before and after hash and explanation.
- The MVP allows one AI repair attempt.

### Deployment boundary

- Only the explicitly named normalized-output directory is retrieved.
- The Sandbox filesystem as a whole is never deployed.
- The deployment adapter receives an immutable manifest.
- The worker, not the Sandbox, owns the Vercel credential.
- Provider IDs and artifacts are associated with one app version and deployment.
- A suspended deployment cannot be republished without an authorized state transition.

### Browser and domain isolation

The dashboard and uploaded applications must use different registrable domains:

```text
Trusted dashboard:       pocketcloud.example
Customer applications:  pocketcloudusercontent.example
```

Using sibling subdomains of the trusted dashboard domain is insufficient if shared domain cookies or future configuration could expose trusted state.

Published applications receive:

- No dashboard authentication cookies
- No platform API credential
- No database credential
- `X-Content-Type-Options: nosniff`
- A deliberate Content Security Policy
- Restricted browser permissions
- A default restriction on external connections, forms, popups, and navigation where compatible with the supported product contract

Dashboard previews use a sandboxed iframe with the minimum required permissions. Untrusted content must not be rendered directly inside the trusted dashboard origin.

Static JavaScript is executable code. File validation cannot prove that arbitrary JavaScript is benevolent, so origin isolation and browser restrictions remain mandatory even if future antivirus scanning is added.

### Abuse and cost controls

- IP burst limit before expensive processing
- Per-actor hourly and daily deployment quota
- One active deployment per actor in the MVP
- Global worker-concurrency limit
- Sandbox time and creation budget
- AI request, token, and cost budget
- Bounded provider retries
- Automatic temporary suspension after repeated policy rejections
- Immediate deployment kill switch

### Logging and privacy

Record:

- Actor, IP where appropriate, app, version, and deployment IDs
- Original and normalized artifact hashes
- Rule results and rejection reason codes
- Sandbox and provider correlation IDs
- AI operation metadata and changed-file list
- Usage counters and state transitions
- Suspension and deletion actions

Do not log:

- Complete source files
- Archive contents
- Credentials or secrets
- AI or Vercel keys
- Database connection strings
- Signed upload or download URLs after their diagnostic usefulness expires

## Security status model

MVP statuses:

```text
QUARANTINED
PLATFORM_CHECKING
PLATFORM_REJECTED
PLATFORM_CHECKS_PASSED
NORMALIZING
READY_TO_DEPLOY
DEPLOYED
SUSPENDED
```

Reserved for future scanner integration:

```text
MALWARE_SCAN_PENDING
MALWARE_SCAN_PASSED
MALWARE_SCAN_FAILED
MALWARE_DETECTED
```

The future statuses cannot be written until a real scanner result exists.

## Kill switch and incident handling

Every app needs an operator action that:

1. Changes the app or deployment to `SUSPENDED`.
2. Removes or disables the public alias.
3. Prevents automatic redeployment.
4. Stops active jobs and Sandboxes.
5. Preserves minimal audit evidence.
6. Allows later deletion according to policy.

A public reporting mechanism and formal takedown workflow are later product requirements, particularly before anonymous or broadly public hosting.

## Explicit third-party security TODOs

The following are not part of the first implementation:

- TODO: Antivirus scanning such as ClamAV
- TODO: Known-malware hash and reputation service
- TODO: Dependency vulnerability scanner
- TODO: Software supply-chain and lockfile scanner
- TODO: Advanced secret-scanning engine
- TODO: Phishing-page detection
- TODO: Malicious JavaScript static and behavioral analysis
- TODO: Headless-browser behavior monitoring
- TODO: Static application security testing
- TODO: Container-image vulnerability scanning
- TODO: Human review queue
- TODO: Commercial malware-detection service
- TODO: Formal abuse-reporting and takedown process

Do not send private customer source to public malware-analysis services without a clear privacy decision and customer agreement. OWASP explicitly notes the data-leakage risk of public scanning services. See [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

## Security promise

Appropriate MVP language:

> Every upload is isolated, constrained, inspected against PocketCloud platform rules, and deployed separately from trusted systems.

Inappropriate language:

> Every upload is guaranteed to be free from malware or malicious behavior.

No code-only system can make the second guarantee.
