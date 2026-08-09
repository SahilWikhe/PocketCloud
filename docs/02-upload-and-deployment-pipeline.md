# Upload and Deployment Pipeline

## Goal

The pipeline converts an untrusted ZIP into an approved immutable artifact and then into a live URL. It must be observable, resumable, idempotent, constrained, and understandable to the customer.

## Customer-visible flow

```text
Upload received
    -> Checking your project
    -> Fixing issues
    -> Preparing deployment
    -> Publishing
    -> Final check
    -> App ready
```

Customer language must not expose provider-specific concepts such as Vercel `readyState`, SHA uploads, build container IDs, or raw AI failures.

## Internal state machine

Recommended deployment states:

```text
CREATED
UPLOADING
QUARANTINED
QUEUED
CLAIMED
SANDBOX_STARTING
ANALYZING
NORMALIZING
VALIDATING
READY_TO_DEPLOY
DEPLOYING
VERIFYING
READY
FAILED
CANCELLED
SUSPENDED
```

Terminal states are `READY`, `FAILED`, `CANCELLED`, and `SUSPENDED`.

Each state transition writes a deployment event. The database record is authoritative; the browser may disconnect and reconnect without losing progress.

## Detailed pipeline

### 1. Create the deployment

The web application asks the API to create a deployment intent.

The API:

- Applies the traffic and account quota.
- Creates or identifies the logical app.
- Creates an immutable app version and deployment record.
- Generates a single-use private upload destination.
- Returns the deployment ID and upload details.

An idempotency key prevents double-clicks or retries from creating duplicate deployments.

### 2. Upload into quarantine

The browser uploads the ZIP directly to private object storage when practical. The API does not buffer the entire archive in memory.

The object receives:

- A generated storage key
- Expected maximum size
- Content hash after upload
- Owner or temporary actor identifier
- Creation and expiration timestamps
- `QUARANTINED` status

The original object is immutable and never published.

### 3. Enqueue work

After storage confirms the upload, the API creates a `deployment_jobs` record. The API returns immediately; it does not wait for the deployment.

For the first implementation, PostgreSQL is the durable job record and one worker claims jobs with transactional locking. The job-delivery mechanism is kept behind an adapter so a managed queue can replace it later.

### 4. Claim idempotently

A worker may process a job only if it can atomically move the job from `QUEUED` to `CLAIMED`. The claim has an expiration or heartbeat so an interrupted worker does not leave a job stuck forever.

Provider requests include stable idempotency identifiers where supported.

### 5. Create the Sandbox

The worker creates a non-persistent Vercel Sandbox configured with:

- No PocketCloud environment variables
- No database or storage credentials
- No deployment or AI credentials
- Default-deny network policy
- No exposed ports for the static MVP
- Strict CPU, memory, disk, and wall-clock limits
- A unique deployment correlation ID

The worker retrieves the original ZIP and transfers it into the Sandbox.

### 6. Validate and extract

The extraction routine enforces archive policy before and during extraction:

- Compressed-size limit
- Expanded-size limit
- File-count limit
- Individual-file limit
- Directory-depth limit
- No absolute paths
- No `..` path traversal
- No symlinks or hard links
- No nested archives in the MVP
- No control characters in paths
- No overwriting previously extracted files through path aliases

If any rule fails, processing stops and the customer receives a stable rejection message.

### 7. Analyze the project

The analyzer produces a `ProjectPlan` and evidence:

- Project type
- Detected root directory
- Entry point
- File inventory
- Runtime and framework when relevant
- Install, build, start, and output configuration when relevant
- Required environment variables
- Unsupported or ambiguous conditions

The MVP accepts only a static plan.

### 8. Apply deterministic normalization

Known safe transformations run first. The output goes to a new canonical directory rather than modifying the extracted original.

Each transformation records:

- Rule identifier
- Affected paths
- Before and after hashes
- Human-readable explanation
- Whether it requires customer attention

### 9. Request one AI patch when necessary

The MVP calls AI only if unresolved problems remain and policy allows a repair.

The worker sends:

- Project manifest
- Selected UTF-8 text files within size limits
- Deterministic findings
- A strict structured-output schema

The AI returns proposed file operations. It does not receive a shell, storage credentials, provider credentials, or the ability to deploy.

The patch validator rejects:

- Absolute paths
- Paths outside the working directory
- Unsupported file types
- Excessive changed files or bytes
- Deletes outside the allowed normalized tree
- Commands or tool invocations
- Binary output where text is required

Accepted changes are applied in the Sandbox and recorded.

### 10. Validate the normalized artifact

Static validation confirms:

- `index.html` exists at the artifact root
- Every output path complies with policy
- File and total sizes remain within limits
- No disallowed file type exists
- Local asset references resolve where deterministically checkable
- The final directory contains only deployment output
- The original upload was not modified

Later framework validation runs the approved build and tests inside the Sandbox.

### 11. Retrieve and store the artifact

The worker retrieves only the normalized output directory. It calculates an artifact hash, writes the output to private object storage, and records a manifest.

The entire Sandbox filesystem is never promoted.

### 12. Deploy through the provider adapter

The Vercel adapter converts the normalized artifact into Vercel's current API contract.

Vercel currently documents the REST workflow as:

1. Generate a SHA for each file.
2. Upload files.
3. Create a deployment referencing those files.

This behavior must stay inside the provider adapter because endpoints and payloads can change. Prefer the maintained Vercel SDK where it covers the required workflow. See [Vercel deployment documentation](https://vercel.com/docs/deployments/overview).

### 13. Monitor provider status

The worker stores the provider deployment ID and polls or consumes provider events within a capped interval.

Provider states are mapped into PocketCloud states. Raw logs remain internal; customer-safe error classification is generated separately.

Vercel exposes deployment events and build logs through its deployment events API. See [Vercel deployment events](https://vercel.com/docs/rest-api/deployments/get-deployment-events).

### 14. Verify the result

When the provider reports success, PocketCloud performs a final HTTP check:

- URL resolves over HTTPS
- Root returns an acceptable status
- Response is not an unexpected provider error page
- Entry document is present

The MVP does not execute the published application's JavaScript as a security verdict.

### 15. Publish the result

The deployment moves to `READY`, the live URL becomes visible, usage is recorded, and the customer receives a change summary.

### 16. Clean up

The worker stops the Sandbox whether processing succeeds, fails, or is cancelled. Temporary credentials, URLs, and local artifacts expire. The original and normalized artifacts follow the retention policy.

## Failure handling

Errors are classified into stable categories:

- `UPLOAD_INVALID`
- `ARCHIVE_LIMIT_EXCEEDED`
- `ARCHIVE_UNSAFE_PATH`
- `FILE_TYPE_NOT_ALLOWED`
- `PROJECT_UNSUPPORTED`
- `ENTRYPOINT_MISSING`
- `NORMALIZATION_FAILED`
- `AI_BUDGET_EXCEEDED`
- `VALIDATION_FAILED`
- `PROVIDER_RATE_LIMITED`
- `PROVIDER_DEPLOYMENT_FAILED`
- `VERIFICATION_FAILED`
- `INTERNAL_RETRYABLE`

Every error records an internal cause and a separate customer-safe explanation.

Temporary provider and network failures receive bounded exponential backoff. Invalid input and deterministic policy failures are never retried automatically.

## Timing targets

For a small static ZIP:

| Stage | Target |
|---|---:|
| Browser upload | 1-5 seconds |
| Sandbox startup and transfer | 1-5 seconds |
| Extraction and deterministic checks | 1-3 seconds |
| Deterministic normalization | 1-2 seconds |
| Optional AI repair | 4-15 seconds |
| Final validation | 1-3 seconds |
| Vercel upload and deployment | 5-20 seconds |
| Final HTTP check | 1-3 seconds |

Product expectations:

- Static project without AI: approximately 10-30 seconds
- Static project with one AI repair: approximately 20-50 seconds
- Provider retry or later build repair: approximately 45 seconds to 2 minutes

These are engineering targets, not vendor SLAs.

## Customer progress delivery

The simplest MVP can poll `GET /deployments/{id}` every few seconds. Later, server-sent events or a realtime channel can deliver deployment events.

The workflow must remain correct regardless of whether the customer keeps the page open.
