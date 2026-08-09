# Costs and Operating Assumptions

## Initial budget

The MVP can be developed privately for very little money. A customer-facing business prototype should budget approximately USD 25 for the first month, before an optional domain.

| Resource | Initial choice | Expected starting cost |
|---|---|---:|
| Dashboard, API, deployment, Sandbox | Vercel Pro for commercial pilot | $20/month |
| AI normalization | OpenAI prepaid API usage | $5 minimum credit purchase |
| Platform database | Neon PostgreSQL Free | $0 initially |
| Artifact storage | Vercel Blob within low initial usage | Usually covered initially |
| Domain | Vercel-generated URLs | $0 |

Vendor prices and included usage can change. Recheck before launch.

## Why not rely on Vercel Hobby for the business pilot

Vercel describes Hobby as intended for personal, non-commercial use. A real PocketCloud pilot is a commercial product and should use Pro, currently listed at $20 per month with included usage credit. See [Vercel pricing](https://vercel.com/pricing).

Hobby may be used only where its terms fit private personal experimentation.

## AI cost model

AI usage is billed separately from ChatGPT subscriptions. New OpenAI API accounts generally use prepaid billing; the current documented minimum purchase is $5. See [OpenAI prepaid billing](https://help.openai.com/en/articles/8264778-what-is-prepaid-billing).

The cost per static normalization should be small when PocketCloud:

- Runs deterministic analysis first
- Sends only selected text files
- Caps input and output tokens
- Requires concise structured output
- Allows one attempt
- Does not send images or binary files

Track actual cost per deployment from the first implementation rather than estimating only from monthly invoices.

## Sandbox costs

Vercel Sandbox is usage-based across active CPU, provisioned memory, creation, network transfer, and optional snapshots. The MVP controls costs by:

- One Sandbox per deployment
- Non-persistent Sandboxes
- Short timeout
- Low CPU and memory allocation
- Default-deny network
- No exposed dev server in the static path
- Two or three globally concurrent jobs
- Guaranteed stop in cleanup

See [Vercel pricing](https://vercel.com/pricing) and [Vercel Sandbox](https://vercel.com/docs/sandbox).

## Storage costs

The MVP stores small ZIP files and normalized static artifacts. Important controls:

- 10 MB upload limit
- 50 MB expanded limit
- Short retention for rejected uploads
- No Sandbox snapshots
- Delete working data at job completion
- Retain successful artifacts only for the defined rollback period

PostgreSQL stores metadata, not file bytes.

## Spend controls

Before allowing external users:

- Disable automatic OpenAI credit recharge or set a low monthly cap.
- Configure Vercel spend alerts and a hard limit appropriate to the pilot.
- Set plan and actor deployment quotas.
- Limit Sandbox concurrency and duration.
- Set one AI attempt and a per-deployment token ceiling.
- Cap provider retries.
- Monitor object-storage growth.
- Ensure cleanup failures create an operator alert.

Vercel's pricing page notes that new teams may have an on-demand usage budget that can be customized. Do not accept a default budget without reviewing it.

## Operational dashboard

At minimum, operators need to see:

- Current deployments by state
- Queue depth and oldest queued job
- Active Sandboxes
- Recent failures by error code
- AI spend and tokens today
- Vercel deployments today
- Storage bytes retained
- Rejected upload count
- Suspended apps
- Cleanup failures

## Initial alerts

Create alerts or at least visible thresholds for:

- Queue oldest age above five minutes
- Deployment failure rate above a chosen baseline
- A Sandbox exceeding the expected duration
- Repeated provider rate limits
- AI cost above daily budget
- Storage growth above expected range
- Worker not claiming jobs
- Failed Sandbox cleanup

## Customer support expectations

The prototype should preserve enough structured data to answer:

- What did the customer upload?
- What did PocketCloud change?
- Which check failed?
- Was AI called and how much did it cost?
- Did Vercel accept the deployment?
- Can the exact normalized artifact be deployed again?

Support should not require access to raw credentials or manually opening untrusted files outside the Sandbox.

## Cost evolution

Likely cost drivers, in expected order:

1. Vercel plan and compute
2. AI normalization and repair loops
3. Sandbox CPU and memory for framework builds
4. Artifact transfer and storage
5. PostgreSQL compute and storage
6. Redis and managed queue usage
7. Additional deployment providers and customer app resources

Pricing should eventually be based on the expensive units PocketCloud actually controls: deployments, build minutes, AI repair attempts, storage, and runtime resources.
