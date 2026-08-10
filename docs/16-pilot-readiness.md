# Controlled Pilot Readiness

## Current gate

The PC-303 software controls and verification procedures are implemented, but the external pilot
is **not ready to open** until an authorized owner completes the billing and live-provider rows
below. Repository tests deliberately do not spend money or mutate Vercel/OpenAI account settings.

## Code-enforced controls

| Control | Enforced state | Evidence |
|---|---|---|
| Actor quotas | 5 deployments/hour, 20/day, 1 active | Transactional API quota policy and tests |
| Upload limit | 10 MB compressed ZIP | Shared schema, browser check, API check |
| Global worker concurrency | 1–3, default 3 | PostgreSQL claim query plus `POCKETCLOUD_GLOBAL_CONCURRENCY` validation |
| Sandbox bounds | One non-persistent 1-vCPU/2-GB environment, deny-all network, bounded lifetime | Execution adapter and worker tests |
| AI repair budget | One attempt, 12,000 input tokens, 2,000 output tokens, bounded files/patch bytes | Normalizer policy and tests |
| Provider retries | Three durable job attempts with capped delay | Deployment job and worker tests |
| Quarantine retention | Upload intent 10 minutes; completed original ZIP 7 days | Upload service metadata |
| Retention cleanup | Worker sweep every 5 minutes by default | `ArtifactRetentionService` deletes expired private bytes and marks metadata deleted |
| Operational visibility | Authenticated `GET /v1/operator/operations` | Queue, failure, Sandbox, AI, storage, rejection, suspension, and cleanup metrics |
| Kill switch | Operator suspension removes the public deployment and cancels work | Mocked API integration plus opt-in live test |
| Security wording | `PLATFORM_CHECKS_PASSED` only | UI, worker event, security docs, and tests |

## Mandatory manual gates

Record evidence outside the repository; never commit tokens, invoices, billing screenshots with
private details, signed URLs, or account recovery information.

| Gate | Required evidence | Status |
|---|---|---|
| Vercel commercial plan | Confirm the pilot team is on Pro or another commercially appropriate plan | Pending owner confirmation |
| Vercel spend control | Record the chosen monthly spend amount; enable notifications and the automatic production-pause action at 100% | Pending owner confirmation |
| OpenAI balance | Confirm prepaid credit is available for the approved pilot budget | Pending owner confirmation |
| OpenAI recharge | Record auto-recharge as disabled, or record its amount, threshold, and monthly recharge limit | Pending owner confirmation |
| Live Sandbox | Run the opt-in Vercel Sandbox integration test on approved resources | Pending cost authorization |
| Live deployment | Run the opt-in Vercel deployment integration test on the pilot project | Pending cost authorization |
| Live kill switch | Run the opt-in PC-303 test and retain its deployment/action IDs | Pending cost authorization |
| Alert ownership | Name the operator watching spend, queue age, failures, and cleanup metrics | Pending team assignment |

As of August 9, 2026, Vercel documents Pro Spend Management as an explicit amount with alerts,
webhooks, and an optional automatic pause action. Merely setting an amount does not pause
production unless that action is enabled. See [Vercel Spend Management](https://vercel.com/docs/spend-management)
and the [Vercel Pro plan](https://vercel.com/docs/plans/pro-plan).

OpenAI documents that prepaid setup enables auto recharge by default; teams that leave it enabled
can set a recharge amount, threshold, and optional monthly limit. See
[OpenAI prepaid billing](https://help.openai.com/en/articles/8264644-manage-your-chatgpt-subscription).

## Operational snapshot

With operator controls configured, request:

```text
GET /v1/operator/operations
x-pocketcloud-operator-key: <operator secret>
x-pocketcloud-operator-id: <operator identity>
```

Review at least:

- queue depth, active claims, and oldest queued age;
- deployment counts and failures by stable code;
- active Sandbox-stage deployments and Sandbox usage;
- AI input/output tokens and provider deployments today;
- retained/quarantined artifact bytes and rejected uploads;
- suspended apps and cleanup failures.

Initial alert thresholds remain operator policy: oldest queue over five minutes, repeated provider
limits, unexpected AI/storage growth, Sandbox duration above policy, worker claim inactivity, or
any cleanup failure require review.

## Live verification procedure

These commands create billable provider resources. Run them only after the manual spend gates are
recorded and the account owner explicitly authorizes the test window.

```text
pnpm --filter @pocketcloud/execution test:integration:vercel
pnpm --filter @pocketcloud/deployment test:integration:vercel
pnpm --filter @pocketcloud/api test:integration:kill-switch
```

The kill-switch test deploys a tiny static fixture, registers it in an isolated local database,
calls the authenticated suspension route, verifies the app/deployment are suspended, and invokes
idempotent provider removal. Its `finally` path also removes the provider deployment.

## External security engines

The pilot implements isolation and deterministic platform checks. Antivirus, malware reputation,
dependency scanning, supply-chain scanning, advanced secret scanning, phishing detection,
malicious-JavaScript analysis, browser behavior monitoring, SAST, container scanning, human review,
and formal takedown automation remain explicit TODOs. Do not call an upload malware-free.
