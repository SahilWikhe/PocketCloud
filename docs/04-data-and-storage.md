# Data and Storage Model

## Chosen database

PocketCloud uses PostgreSQL as its durable system of record, hosted initially by Neon.

PostgreSQL is the long-term technology decision. Neon is the initial managed host and can be replaced without changing the data model or product contract.

Reasons for the choice:

- Strong relational consistency for apps, versions, jobs, usage, and billing
- Transactions for quota checks and idempotent job claims
- Standard SQL and broad tooling
- Serverless connection pooling
- Free initial tier and usage-based growth
- Native integration options with Vercel

See [Postgres on Vercel](https://vercel.com/docs/postgres), [Neon pricing](https://neon.com/pricing), and [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).

## Storage responsibilities

### PostgreSQL stores metadata

- Users and organizations
- Apps and app versions
- Deployment attempts and events
- Project plans
- Normalization change records
- Job claims and retries
- Usage events and quota counters
- Provider references
- Suspension and deletion state

### Object storage stores files

- Original quarantined ZIP
- Optional extraction manifest
- Final normalized artifact
- Future build output or diagnostic bundle

The MVP uses private Vercel Blob storage or an equivalent object-storage adapter. Large bytes are not stored inside PostgreSQL.

### Sandbox stores temporary working state

- Extracted files
- Working copy
- Normalization intermediates
- Temporary build files later

The Sandbox is not a durable source of truth. It is destroyed after processing.

## Core entities

### `users`

Added when authentication is introduced.

| Field | Purpose |
|---|---|
| `id` | Internal identifier |
| `email` | Verified identity |
| `status` | Active, suspended, deleted |
| `created_at` | Audit timestamp |

### `organizations`

The billing and ownership boundary for the finished product.

| Field | Purpose |
|---|---|
| `id` | Organization identifier |
| `name` | Display name |
| `plan` | Free, starter, business, enterprise |
| `status` | Active, suspended, deleted |
| `created_at` | Audit timestamp |

### `organization_members`

| Field | Purpose |
|---|---|
| `organization_id` | Organization |
| `user_id` | User |
| `role` | Owner, admin, member, viewer |
| `created_at` | Audit timestamp |

### `apps`

The logical application across versions and deployments.

| Field | Purpose |
|---|---|
| `id` | App identifier |
| `organization_id` | Future owner; nullable only in prototype mode |
| `name` | Customer-facing name |
| `slug` | Stable platform slug |
| `status` | Active, suspended, deleted |
| `active_version_id` | Currently published version |
| `created_at`, `updated_at` | Audit timestamps |

### `app_versions`

An immutable upload and its derived artifact.

| Field | Purpose |
|---|---|
| `id` | Version identifier |
| `app_id` | Parent app |
| `sequence` | Human-friendly version number |
| `original_artifact_id` | Immutable source upload |
| `normalized_artifact_id` | Approved derived output |
| `project_plan` | Versioned structured JSON plan |
| `platform_check_status` | Result of PocketCloud checks |
| `created_at` | Creation timestamp |

### `artifacts`

| Field | Purpose |
|---|---|
| `id` | Artifact identifier |
| `kind` | Original, normalized, build-output, diagnostic |
| `storage_provider` | Initial value `vercel_blob` |
| `storage_key` | Private object key, never a permanent signed URL |
| `sha256` | Content identity |
| `compressed_bytes` | Stored bytes |
| `expanded_bytes` | Expanded bytes when applicable |
| `file_count` | Manifest count |
| `status` | Quarantined, approved, rejected, deleted |
| `expires_at` | Retention boundary |
| `created_at` | Audit timestamp |

### `deployments`

One attempt to publish an app version.

| Field | Purpose |
|---|---|
| `id` | PocketCloud deployment ID |
| `app_id`, `version_id` | Ownership and source |
| `status` | State-machine value |
| `provider` | Initial value `vercel` |
| `provider_project_id` | Provider reference if used |
| `provider_deployment_id` | Provider attempt reference |
| `public_url` | Live result after success |
| `idempotency_key` | Duplicate-request protection |
| `error_code` | Stable error taxonomy |
| `error_summary` | Customer-safe summary |
| `started_at`, `finished_at` | Timing |
| `created_at`, `updated_at` | Audit timestamps |

### `deployment_events`

Append-only progress and audit events.

| Field | Purpose |
|---|---|
| `id` | Event identifier |
| `deployment_id` | Parent deployment |
| `sequence` | Ordering within deployment |
| `type` | State change, progress, warning, error |
| `code` | Stable machine-readable code |
| `customer_message` | Safe display text |
| `internal_metadata` | Restricted structured details |
| `created_at` | Event time |

### `deployment_jobs`

The initial durable queue and claim record.

| Field | Purpose |
|---|---|
| `id` | Job identifier |
| `deployment_id` | One job per deployment stage or workflow |
| `status` | Queued, claimed, completed, failed, cancelled |
| `attempt` | Current attempt count |
| `max_attempts` | Retry budget |
| `available_at` | Backoff and scheduling time |
| `claimed_by` | Worker identity |
| `claim_expires_at` | Recovery from interrupted worker |
| `last_error_code` | Stable retry diagnosis |
| `created_at`, `updated_at` | Audit timestamps |

### `normalization_changes`

| Field | Purpose |
|---|---|
| `id` | Change identifier |
| `version_id` | Parent version |
| `source` | Deterministic rule or AI |
| `rule_code` | Stable rule identifier |
| `path` | Normalized relative path |
| `before_sha256`, `after_sha256` | Traceability |
| `summary` | Customer-understandable explanation |
| `created_at` | Timestamp |

### `usage_events`

Append-only record used for quotas and future billing.

| Field | Purpose |
|---|---|
| `id` | Event identifier |
| `actor_id` or `actor_key` | User, organization, or temporary IP-derived actor |
| `deployment_id` | Related deployment |
| `metric` | Deployment, upload bytes, AI tokens, Sandbox time, etc. |
| `quantity` | Numeric usage |
| `provider` | Related vendor where applicable |
| `created_at` | Usage time |

### `usage_limits`

| Field | Purpose |
|---|---|
| `scope_type`, `scope_id` | Plan, organization, user, or actor |
| `metric` | Limited resource |
| `window` | Minute, hour, day, month, concurrent |
| `limit_value` | Allowed quantity |
| `updated_at` | Policy timestamp |

## MVP subset

Before authentication and organizations, the minimum useful schema is:

```text
apps
app_versions
artifacts
deployments
deployment_events
deployment_jobs
normalization_changes
usage_events
```

An `actor_key` derived from a privacy-conscious temporary identifier or IP policy can support prototype quotas. Do not pretend this is durable customer identity.

## Data invariants

- An original artifact is immutable.
- A version references at most one approved normalized artifact.
- A deployment references exactly one app version.
- A public URL becomes visible only after `READY`.
- Only one active job claim exists for a job.
- Usage events are append-only.
- Customer-visible errors contain no secrets or raw source.
- Signed storage URLs are temporary and are not used as durable identifiers.
- Deleting an app is a state transition before irreversible artifact deletion.

## Database access pattern

The API and worker use a pooled PostgreSQL connection suitable for serverless or horizontally scaled processes. Transactions protect:

- Quota check plus deployment creation
- Idempotency-key creation
- Job claim
- App active-version promotion
- Suspension and alias removal coordination

The database region should be close to the API and worker region.

## Retention starting point

Suggested prototype defaults:

| Data | Retention |
|---|---|
| Rejected raw upload | 24 hours or less |
| Failed working data | Sandbox lifetime only |
| Successful original ZIP | 7 days during prototype |
| Normalized deployed artifact | While deployment is active, plus rollback window |
| Deployment events | 30 days during prototype |
| Security and suspension audit | Longer, subject to privacy policy |

Retention becomes a customer-facing policy before public launch.

## Customer app databases

The PocketCloud PostgreSQL database stores PocketCloud's own control-plane data. It must not be used as the database for uploaded customer applications.

Future customer app databases are provisioned as separate, isolated resources through a dedicated capability:

```text
PocketCloud platform database
  -> users, apps, deployments, billing

Provisioned customer databases
  -> each customer application's business data
```

That capability is outside the static MVP.
