# Rate Limiting and Scaling

## Principle

PocketCloud should design the usage boundary now without building internet-scale infrastructure before it has traffic.

Rate limiting is not one counter. It is a set of controls protecting different resources:

```text
Traffic bursts
Customer entitlement
Concurrent background work
AI budget
Sandbox budget
Deployment-provider limits
```

## Layer 1: Edge traffic protection

The first limit runs before a request reaches the API.

Initial rule:

```text
Path: /api/deploy or its final equivalent
Key: source IP
Limit: 10 requests per 10 minutes
Action: HTTP 429
```

Vercel WAF rate limiting can provide this edge layer. Vercel currently documents rate limiting on all plans, with fixed-window limiting on Hobby and Pro. See [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).

IP limits reduce obvious abuse but are not a business quota. Multiple legitimate users may share an office IP, and one user may change IPs.

## Layer 2: Customer or actor quota

The API checks a durable quota in PostgreSQL before creating a deployment.

Prototype limits:

```text
5 deployments per actor per hour
20 deployments per actor per day
1 active deployment per actor
10 MB maximum upload
```

After authentication, the quota key becomes the organization and optionally the user. Plan policy can then define limits such as:

| Plan | Deployments | Active jobs | AI attempts |
|---|---:|---:|---:|
| Free | 10/month | 1 | 1 per deployment |
| Starter | 100/month | 2 | 2 per deployment |
| Business | 1,000/month | 10 | Higher bounded allowance |
| Enterprise | Contract | Contract | Contract |

The table illustrates the model; pricing and final quantities are undecided.

The quota check and deployment creation must occur in one transaction to avoid concurrent requests both passing the same limit.

## Layer 3: Worker concurrency

Accepted deployments wait in a queue. The number accepted from customers is independent from the number processed simultaneously.

Initial global policy:

```text
2-3 simultaneous deployment jobs
1 job per actor
1 Sandbox per job
```

This keeps AI, Sandbox, database, and Vercel usage predictable.

As traffic grows, worker pools can be separated by workload:

```text
Static normalization workers
Frontend-build workers
Backend-build workers
Provider-monitor workers
```

Jobs must tolerate duplicate delivery and out-of-order retry. Database state and idempotency keys prevent duplicate external deployments.

## Layer 4: AI budgets

Every deployment has a hard AI budget:

- Maximum repair attempts
- Maximum files included
- Maximum input tokens
- Maximum output tokens
- Maximum wall-clock time
- Maximum estimated cost

The static MVP allows one AI attempt. A deterministic result does not call AI.

If the provider rate-limits the request, the job returns to the queue with bounded exponential backoff. The customer sees a delay message, not the provider's raw error.

## Layer 5: Sandbox budgets

Control:

- Creations per actor and globally
- Concurrent Sandboxes
- vCPU and memory selection
- Maximum wall-clock duration
- Network-transfer budget
- Snapshot usage, which is disabled for MVP upload processing

Every worker cleanup path stops the Sandbox. A reconciliation process later detects and stops leaked environments.

## Layer 6: Deployment-provider budgets

The Vercel adapter owns:

- Provider concurrency
- API-rate-limit response handling
- Stable idempotency data
- Poll interval and maximum polling duration
- Deployment count limits
- Cancellation and deletion

When Vercel returns a retryable limit, the worker respects the provider's retry guidance where available, adds jitter, and requeues within the job budget.

## Response behavior

When a limit is reached, return:

- HTTP `429` for request-rate and account-quota limits
- A `Retry-After` header where a useful time is known
- A stable error code
- A plain-language message

Example:

```json
{
  "error": {
    "code": "DEPLOYMENT_RATE_LIMITED",
    "message": "You have reached the current deployment limit. Try again in 18 minutes.",
    "retryAfterSeconds": 1080
  }
}
```

## Why PostgreSQL first

PostgreSQL provides durable, transactional quotas and job claims without another service. This is adequate for the MVP and early usage.

Do not use process memory for authoritative limits. Serverless or horizontally scaled instances do not share that memory.

## When Redis is added

Redis becomes useful when high-frequency counters create unnecessary database traffic or when limits need low-latency rolling windows across many instances.

The later design becomes:

```text
Vercel Firewall
    -> obvious IP bursts

Redis
    -> short-lived request counters and fast concurrency leases

PostgreSQL
    -> durable entitlements, usage ledger, billing record

Managed queue
    -> reliable job buffering, retries, and worker flow control
```

Vercel's storage guidance positions Postgres for durable relational data and Redis for caching and rate limiting. See [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage).

## When a managed queue is added

Move job delivery out of PostgreSQL when one or more are true:

- Job polling becomes operationally awkward.
- Multiple worker groups require fan-out.
- Retry timing and visibility need stronger guarantees.
- Traffic spikes create a large backlog.
- Deployment workflows require durable multi-step sleeps or callbacks.

Vercel Queues is one future option and currently provides automatic retries, concurrency control, deduplication, and scaling, but is documented as beta as of this architecture date. See [Vercel Queues](https://vercel.com/docs/queues).

## Scaling stages

### Stage 1: Prototype

```text
WAF + PostgreSQL + one worker + strict concurrency
```

### Stage 2: Early product

```text
WAF + PostgreSQL + object storage + managed queue + multiple workers
```

### Stage 3: Growing product

```text
WAF + Redis + PostgreSQL + managed queue + workload-specific worker pools
```

### Stage 4: Large platform

```text
Global traffic policy
+ dedicated usage pipeline
+ regional workers
+ multiple execution providers
+ multiple deployment providers
+ cost and capacity forecasting
```

The customer-facing deployment API should remain stable through these stages.

## Metrics to collect from the beginning

- Deployment requests accepted and rejected
- Quota rejection count by rule
- Queue depth and oldest-job age
- Active workers and Sandboxes
- Time spent in each deployment state
- AI calls, tokens, latency, and cost
- Provider API calls, limits, and retries
- Success rate by project classification
- Artifact sizes and file counts
- Cleanup failures and leaked-resource reconciliation

Scaling decisions should be made from these measurements rather than projected traffic alone.
