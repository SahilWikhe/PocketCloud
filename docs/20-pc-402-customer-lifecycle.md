# PC-402 Customer Lifecycle Controls

## Outcome

Signed-in PocketCloud customers can now manage their own projects from the dashboard:

- **Redeploy** republishes the already approved immutable version.
- **Suspend** removes public availability while preserving the project and history.
- **Restore** activates a customer-suspended or recoverable deleted project and publishes its
  approved version again.
- **Delete** immediately removes public availability and starts a seven-day recovery window.

Each action is workspace-scoped, idempotent, recorded in Neon, and shown in the dashboard. An
operator suspension remains stronger than customer controls and cannot be bypassed with restore or
delete.

## Modular boundaries

```text
Dashboard
  -> customer lifecycle HTTP routes
  -> CustomerLifecycleService (ownership and business rules)
       -> Neon repositories (state, action audit, job, checkpoint)
       -> DeploymentRemovalProvider (remove old public deployment)
       -> DeploymentDispatcher (publish approved version asynchronously)

Worker
  -> loads the seeded approved-artifact checkpoint
  -> skips Sandbox analysis and normalization
  -> publishes and verifies a new Vercel deployment
```

The browser never calls Vercel directly. The lifecycle service depends only on the small
`remove(providerDeploymentId)` interface already used by operator suspension. This keeps the
provider replaceable and gives PC-403 one clear seam for future custom-domain cleanup.

Clerk remains only the identity provider. It does not own app status or lifecycle permissions.
Neon remains authoritative for workspace ownership, recovery state, action history, jobs, and
approved artifact references.

## Data additions

Migration `0006_customer_lifecycle.sql` adds:

- app suspension source (`CUSTOMER` or `OPERATOR`);
- soft-delete and recovery timestamps;
- `customer_app_actions`, an idempotent audit record for every lifecycle request.

Normalized artifacts for a deleted app receive the same seven-day expiry as the app's recovery
deadline. The existing retention job permanently removes those private artifact bytes after the
window. Restoring before the deadline clears that scheduled normalized-artifact expiry.

Original ZIPs keep their existing independent MVP retention policy.

## Customer API

All routes require a verified customer session and an `Idempotency-Key` header:

```text
POST   /v1/customer/apps/:appId/redeploy
POST   /v1/customer/apps/:appId/suspend
POST   /v1/customer/apps/:appId/restore
DELETE /v1/customer/apps/:appId
```

Only workspace owners and admins can manage projects. Cross-workspace IDs return `NOT_FOUND`.
Reusing an idempotency key for a different app or action returns `CONFLICT`.

## Redeploy and restore behavior

An app version stays immutable. Redeploy and restore create a new deployment for the current
approved version and seed the worker checkpoint with its existing normalized artifact and project
plan. The worker therefore skips uploaded-ZIP inspection, Sandbox creation, deterministic repair,
and AI repair. It only performs provider publishing and final verification.

This prevents a redeploy from silently changing the approved files and avoids depending on the
shorter-lived original ZIP.

## Suspend and delete behavior

Suspend and delete lock the app row, cancel in-flight jobs, move active deployments to a suspended
state, clear customer-visible URLs, and call the provider-removal interface. Provider removal is
idempotent. A failed cleanup leaves the project unavailable in PocketCloud, records a failed audit
action, and allows the same request to retry cleanup safely.

Delete is intentionally recoverable rather than destructive. Permanent app-row deletion, account
legal retention, and customer-facing policy text remain PC-406 work.

## Shared contract changes

`CustomerDashboardV1` now adds:

- `apps[].liveUrl`;
- app status `DELETED`;
- `suspensionSource` and `recoverableUntil`;
- server-derived `availableActions` booleans;
- recent audited `actions`.

`CustomerAppActionV1` is the additive response shared by all four lifecycle routes. Deployment
provider, execution, worker-job, artifact-manifest, and Clerk contracts are unchanged.

## Environment and owner step

No new secret is introduced. Hosted lifecycle controls are enabled when the existing
`VERCEL_TOKEN` and `VERCEL_PROJECT_NAME` are present; optional `VERCEL_PROJECT_ID` and
`VERCEL_TEAM_ID` continue to scope provider calls.

Vercel applies pending migrations before building the application. The Neon integration injects
the matching connection, so Preview changes stay isolated and a Production build migrates the
default branch before the new functions become active. The migration runner serializes concurrent
builds through its ledger table and remains idempotent.

For a manual or local rollout, apply pending migrations to the selected database explicitly:

```text
pnpm --filter @pocketcloud/platform db:migrate
```

Production uses the Neon default branch. Vercel previews use the matching temporary Neon branch
when the existing Neon/Vercel branch integration is active.

## Security and cost impact

- The server derives workspace ownership from the verified Clerk identity.
- Operator-blocked projects cannot be customer-restored or deleted to evade the block.
- Public URLs are returned only for active apps and verified ready deployments.
- Customer actions never expose provider IDs, credentials, logs, or storage keys.
- Redeploy and restore create one provider deployment but no new Sandbox or AI work.
- Dashboard reads and audit rows add small Neon usage.

## Verification

Automated coverage includes concurrent idempotent redeploy requests, approved-artifact checkpoint
reuse, cross-workspace denial, customer suspension, provider removal, recoverable deletion,
restoration, and operator-block enforcement, plus existing repository-wide quality checks.

## Handoff

```text
Story: PC-402
Lane: Customer control plane and shared integration
Branch: agent/pc-402-customer-lifecycle
Author: Builder A and Builder B represented by one implementation owner
Required reviewer: project owner for shared API, migration, worker checkpoint, and Vercel removal seams
```

PC-403 may now add domain records, DNS guidance, and a Vercel-domain adapter without changing this
customer lifecycle service. Its safe-detach implementation should coordinate with the existing
suspend/delete service boundary before provider deployment removal.

## Merge order

1. Confirm Quality Gate and the migration-backed Vercel Preview pass.
2. Verify redeploy, suspend, restore, and delete from a Preview customer dashboard.
3. Merge PC-402; the Production deployment applies migration `0006` before activating the code.
4. Begin PC-403 from the merged `main` branch.
