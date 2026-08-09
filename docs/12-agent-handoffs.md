# Codex Session and Handoff Guide

## Why this exists

AI coding sessions lose coordination when important context lives only in a chat. Every session should begin from the same repository instructions and end with a compact handoff that another person or model can verify.

## Session-start checklist

Before asking Codex to edit code:

1. Pull current `main`.
2. Confirm the GitHub story is assigned to the correct builder.
3. Confirm dependencies are merged.
4. Confirm no open PR edits the same owned paths.
5. Create a fresh story branch.
6. Give Codex the story ID and builder lane.

## Builder A starter prompt

```text
Read AGENTS.md and every required document it lists before editing.

I am Builder A in the Control Plane lane. Work only on story <PC-ID> from docs/10-user-stories.md.

First verify the story dependencies are present in this branch and inspect the worktree for unrelated changes. Stay within the story's primary paths. Do not edit apps/worker, packages/execution, packages/normalizer, packages/deployment, or Builder B's test fixtures.

Use the merged contracts from packages/core and docs/11-shared-contracts.md. If a contract change is necessary, stop before editing shared contracts and explain the exact interface change and affected consumers.

Implement the story, add proportional tests, run relevant checks, and finish with the handoff format in docs/12-agent-handoffs.md.
```

## Builder B starter prompt

```text
Read AGENTS.md and every required document it lists before editing.

I am Builder B in the Execution Plane lane. Work only on story <PC-ID> from docs/10-user-stories.md.

First verify the story dependencies are present in this branch and inspect the worktree for unrelated changes. Stay within the story's primary paths. Do not edit apps/web, apps/api, packages/platform, database migrations, root workspace configuration, or shared domain contracts.

Use the merged contracts from packages/core and docs/11-shared-contracts.md. If a contract change is necessary, stop before editing shared contracts and explain the exact interface change and affected consumers.

Implement the story, add proportional tests, run relevant checks, and finish with the handoff format in docs/12-agent-handoffs.md.
```

## Integration-story starter prompt

```text
Read AGENTS.md and every required document it lists before editing.

We are integrating story <PC-ID>. Identify the merged control-plane and execution-plane contracts and list the exact integration seams before changing code.

Do not rewrite either lane's internals to make integration easier. Connect them through public package exports and docs/11-shared-contracts.md. If the contracts are insufficient, stop and propose one reviewed interface change.

Inspect open PRs for overlapping integration work, implement the smallest integration change, add end-to-end coverage, and finish with the standard handoff.
```

## Standard handoff

Every Codex session should finish with this information:

```text
Story: PC-___
Lane: Control Plane | Execution Plane | Integration
Branch: agent/pc-___-description

Outcome:
- What now works

Files owned and changed:
- path

Shared contracts:
- None
or
- Exact contract change and affected consumers

Verification:
- Command and result

Security impact:
- None
or
- Limits, credentials, trust boundary, or exposure changed

Cost impact:
- None
or
- New provider call or resource usage

Known limitations:
- Anything deliberately left out

Handoff to the other builder:
- What they may now depend on
- What they must not assume yet

Merge order:
- Dependencies that must merge first
```

## Pull-request preparation checklist

- Story ID is in title.
- Scope matches one story.
- Changed files fall inside owned paths.
- No unrelated formatting or dependency update is included.
- Tests are present and passing.
- Shared-contract change is called out explicitly.
- Security and cost impact are stated.
- Generated files and lockfile changes are explained.
- PR depends only on merged code, unless clearly marked as a stacked PR.
- The other builder is requested for review when an integration seam changes.

## Review checklist for the other builder

Review the integration surface, not merely style:

- Does the PR use the shared contract rather than inventing another type?
- Does it stay in its lane?
- Does it leak provider SDK types across a boundary?
- Does it create a new database or storage assumption?
- Does it preserve immutable original artifacts?
- Does it keep credentials outside the Sandbox?
- Does deterministic work still precede AI?
- Are error and state semantics compatible with the other lane?
- Are retries idempotent?
- Is the handoff accurate enough for the next story?

## Contract-change request template

```text
Interface change

Current contract:
- Name and relevant fields

Problem:
- Why the current contract cannot support the story

Proposed change:
- Exact additive or breaking change

Consumers affected:
- Packages, apps, or stories

Migration order:
1. Contract and tests
2. Producer
3. Consumer

Compatibility:
- Whether old messages or records remain valid
```

## Blocked-work handoff

If a session cannot continue, do not broaden the story. Record:

```text
Blocked story: PC-___
Blocking dependency or decision:
Evidence:
Work completed safely:
Uncommitted or experimental files:
Exact decision needed:
Suggested next action:
```

## Session-end hygiene

- Do not leave a shared contract half-migrated.
- Do not leave generated credentials or signed URLs in files or logs.
- Do not leave unexplained untracked files.
- Do not combine another story because remaining time is available.
- Make the branch and PR understandable without access to the originating Codex chat.
