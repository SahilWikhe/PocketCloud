# PC-401 Accounts, Workspaces, Landing Page, and Dashboard

## Outcome

PocketCloud now has a real customer boundary around the existing upload-to-link pipeline:

```text
Public visitor
    -> landing page
    -> Clerk sign-up or sign-in
    -> one personal PocketCloud workspace in Neon
    -> authenticated dashboard
    -> workspace-owned upload and deployment
    -> project list and deployment history
```

Clerk owns passwords, sign-in methods, sessions, account recovery, and the account profile UI.
PocketCloud does not store customer passwords. Neon stores the PocketCloud user ID, the matching
Clerk user ID, the personal workspace, the membership role, plan selection, apps, and deployment
history.

## Customer experience

- Anyone can view the product landing page and planned pricing.
- A visitor can create an account or sign in through Clerk.
- The first authenticated request creates one durable PocketCloud user and one personal workspace.
- The dashboard shows project count, live-site count, deployment count, current plan, projects, and
  up to 100 recent deployments.
- The existing ZIP upload experience runs inside the authenticated dashboard.
- Every new app receives the signed-in workspace ID.
- Customer API calls no longer trust the prototype browser identifier in hosted production.
- A person cannot read another workspace's apps or deployment status.

## Data additions

Migration `0005_customer_accounts.sql` adds:

- `users`: the PocketCloud profile mapped to one Clerk identity.
- `workspaces`: personal or future team billing/ownership containers.
- `workspace_memberships`: the user's role in a workspace.
- `apps.workspace_id`: explicit customer ownership for new apps.

Existing prototype apps deliberately keep a null workspace. They are not silently assigned to the
first person who signs in. If preserving prototype projects matters, a separate verified ownership
migration must be designed later.

## Authentication boundary

Hosted production requires Clerk configuration. The Fastify server verifies the Clerk session and
then resolves a PocketCloud workspace context. Upload intents, Blob upload authorization, upload
completion, deployment creation, deployment status, session, and dashboard routes all use that
context.

Local and existing service tests may still create an API without a Clerk identity provider. That
test-only/prototype composition uses the old hashed browser actor and prevents this story from
rewriting unrelated pipeline tests. `buildProductionApi` always installs Clerk and does not use that
fallback.

## Environment setup

Add these in Vercel for Production and Preview:

```text
CLERK_SECRET_KEY                 server secret; never expose or commit
CLERK_PUBLISHABLE_KEY            public Clerk application key for the API
VITE_CLERK_PUBLISHABLE_KEY       same public key for the Vite browser build
```

If the Vercel Clerk integration creates `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, the code accepts it as
a public-key fallback. Using the explicit Vite and server names is still clearer.

Run the migration against each selected Neon database before using the new API:

```text
pnpm --filter @pocketcloud/platform db:migrate
```

With the Neon/Vercel branch integration enabled, production uses the Neon default branch and a
Vercel preview uses its matching temporary Neon branch. The migration must exist on whichever
database the deployment's `DATABASE_URL` selects.

## Routes and contracts

New browser routes:

```text
/
/sign-in/*
/sign-up/*
/dashboard
```

New authenticated API routes:

```text
GET /v1/customer/session
GET /v1/customer/dashboard
```

`CustomerDashboardV1` returns the customer session, workspace, apps, and recent deployment
history. It contains customer-safe failure copy only; raw provider errors remain private.

## Security impact

- Passwords and recovery are delegated to Clerk.
- Hosted customer routes verify the Clerk session server-side.
- Workspace ownership is persisted, not inferred from a client-provided app ID.
- Cross-workspace deployment reads return `NOT_FOUND` so they do not reveal the existence of data.
- Original ZIP storage and isolated execution behavior are unchanged.
- No Clerk secret is sent to Vercel Sandbox or to the browser.

Future Clerk webhook work should synchronize later profile changes and account deletion into Neon.
This story provisions the initial profile from available session claims and uses Clerk directly for
the visible account profile.

## Cost impact

This introduces Clerk as an external account provider and adds small Neon rows and read queries.
It does not create new Vercel projects, Sandboxes, Blob writes, or AI requests by merely viewing the
landing page or dashboard.

## Known limitations and next stories

- Legacy prototype projects are not claimed by new accounts.
- The dashboard is read-only except for creating a new project.
- Delete, suspend, restore, and redeploy are the next lifecycle story.
- Custom domains remain a separate Vercel-backed story.
- Stripe billing, invoices, and spend controls are not enabled yet.
- Email and in-product notification delivery is not enabled yet.
- Final public retention, privacy, and terms pages are not included yet.

## Verification

The story includes tests for:

- unauthenticated rejection;
- idempotent personal workspace provisioning;
- workspace assignment for new uploads;
- app and deployment-history separation between two accounts;
- cross-account deployment denial;
- landing-page product messaging;
- the existing upload success and failure experience.

## Handoff

Story: `PC-401`

Lane: Control Plane and shared integration (Builder A and Builder B are currently represented by
one implementation owner)

Branch: `agent/pc-401-accounts-dashboard`

Shared contracts:

- Added `CustomerSessionV1`, `CustomerAppSummaryV1`, `CustomerDeploymentSummaryV1`, and
  `CustomerDashboardV1`.
- Existing worker jobs, artifacts, normalization, deployment-provider, and queue contracts are
  unchanged.

Merge order:

1. Merge PC-401.
2. Configure Clerk in Vercel Production and Preview.
3. Apply migration `0005_customer_accounts.sql` to the connected Neon environments.
4. Verify sign-up, first workspace creation, upload, and dashboard history in Preview.
5. Begin the lifecycle-control story from the merged `main` branch.
