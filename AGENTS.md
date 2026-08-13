# PocketCloud Agent Working Agreement

These instructions apply to every Codex or AI-assisted coding session in this repository.

## Required reading before changing code

Read, in order:

1. `README.md`
2. `docs/01-system-architecture.md`
3. `docs/03-security-model.md`
4. `docs/09-parallel-development.md`
5. `docs/10-user-stories.md`
6. `docs/11-shared-contracts.md`

Then identify the assigned story ID and confirm its dependencies are merged.

Before implementing framework builds, iterative AI repair, customer backends, provisioned
databases, or other real-project deployment work, also read
`docs/21-real-project-deployment-architecture.md`. Treat it as the proposed target architecture;
the static-only implementation boundaries below remain authoritative until an expansion story
explicitly changes them.

## One story, one owner, one branch

- Work on exactly one claimed story unless the user explicitly expands the scope.
- Use a branch named `agent/<story-id>-<short-description>`.
- Put the story ID in the commit and pull-request title.
- Do not implement work assigned to another active story.
- Do not silently fix unrelated files.
- Never use another builder's unmerged branch as a base unless both builders explicitly agree to a stacked-PR workflow.

## Live work tracking

- `docs/10-user-stories.md` defines the baseline backlog and dependencies.
- GitHub Issues and pull requests are the live source of truth for assignment and status.
- Do not edit the backlog merely to mark a story in progress; that creates avoidable conflicts.
- Before starting, confirm no open PR already implements the story or edits the same owned paths.

## Workstream ownership

### Builder A: Control Plane

Primary paths:

- Root workspace and tool configuration
- `apps/web/**`
- `apps/api/**`
- `packages/platform/**`
- Database schema and migrations
- Authentication, quota, and API contracts

### Builder B: Execution Plane

Primary paths:

- `apps/worker/**`
- `packages/execution/**`
- `packages/normalizer/**`
- `packages/deployment/**`
- `packages/core/src/archive/**`
- `packages/core/src/analyzer/**`
- `packages/core/src/validators/**`
- `tests/sample-apps/**`

### Shared and locked paths

These require coordination before editing:

- Root `package.json`, workspace file, lockfile, and shared compiler/test config
- `packages/core/src/domain/**`
- `packages/core/src/contracts/**`
- Public exports from any package
- Database migrations already merged
- `.github/**`, `AGENTS.md`, and architecture documentation

Builder A is the default integrator for root workspace and domain-contract changes. Builder B should propose contract changes in the PR description before changing shared files.

## Contract-first rule

The lanes integrate through the contracts in `docs/11-shared-contracts.md`.

- Do not invent a second deployment state model, artifact shape, job payload, or error taxonomy.
- Do not import provider SDK types across package boundaries.
- When a contract must change, label the PR section `Interface change`, explain consumers affected, and obtain review from the other builder before merge.
- Additive optional fields are preferred over breaking renames or semantic changes.

## Git and merge rules

- Start branches from current `origin/main`.
- Pull or fetch before starting a new story.
- Keep PRs small enough to review in one sitting.
- Stage only files belonging to the story.
- Rebase or update from `main` before final review when the branch is behind.
- The non-author builder reviews changes to shared contracts and integration seams.
- Merge foundational contract PRs before dependent feature PRs.

## Implementation boundaries

- The MVP supports static projects only.
- Every upload is processed in Vercel Sandbox.
- Deterministic normalization runs before AI.
- AI returns a proposed patch and never controls deployment directly.
- Original uploads remain immutable.
- Neon PostgreSQL is the control-plane system of record.
- File bytes live in private object storage, not PostgreSQL.
- Vercel is the first execution and deployment provider, behind internal interfaces.
- Code-level security controls are implemented now; third-party security scanners remain TODOs.
- Never describe an upload as malware-free. Use `PLATFORM_CHECKS_PASSED` only.

## Verification expectations

Every PR must include:

- Relevant unit or integration tests
- A summary of commands run
- Confirmation that unrelated files were not changed
- Any shared-contract impact
- Security and cost impact when relevant
- A handoff note using `docs/12-agent-handoffs.md`

## Stop conditions

Stop and request coordination if:

- Another open PR edits the same primary paths.
- A dependency story is not merged.
- The task requires changing a shared contract without the other builder's awareness.
- The implementation would expand the MVP beyond static sites.
- A credential, billing decision, or destructive external action is required.
- Existing changes in the worktree are not clearly part of the assigned story.
