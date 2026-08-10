# PC-305 Hosted AI Repair Handoff

## Story

```text
Story: PC-305
Lane: Integration (Builder A implementation; Builder B review required)
Branch: agent/pc-305-ai-repair
Issue: https://github.com/SahilWikhe/PocketCloud/issues/21
```

## Outcome

PocketCloud's existing one-shot structured repair policy is now connected to a real hosted model.
When deterministic normalization leaves an eligible finding, the trusted Vercel worker can ask
Vercel AI Gateway for a schema-validated patch and then pass that proposal through the existing
path, file, byte, token, and final-validation checks.

The AI SDK and AI credentials remain in the trusted worker. Nothing is copied into the customer
Sandbox, uploaded artifact, deployment job, browser response, or database source fields.

## Files changed

- `apps/worker/src/integration/vercel-ai-repair.ts`
- `apps/worker/src/integration/vercel-ai-repair.test.ts`
- `apps/worker/src/integration/vercel-ai-repair.integration.test.ts`
- `apps/worker/src/runtime.ts`
- `apps/worker/package.json`
- `.env.example`
- `pnpm-lock.yaml`

## Shared contracts

None. The adapter implements the merged `AiRepairClient` interface and returns the existing strict
`AiPatchResponse` shape. AI SDK and Gateway types do not cross the worker boundary.

## Production configuration

Before enabling the feature, the owner must confirm the approved Vercel AI Gateway credit balance
and keep auto top-up disabled unless a top-up policy is explicitly approved. Then add this
non-secret variable to the PocketCloud Vercel project for Production and Preview:

```text
POCKETCLOUD_AI_REPAIR_ENABLED=1
```

The default model is `openai/gpt-5.4-mini`. An optional non-secret override may be set with
`POCKETCLOUD_AI_REPAIR_MODEL`, but it must remain an `openai/*` Gateway model so existing usage
attribution stays accurate. Vercel supplies short-lived OIDC credentials to hosted Functions; do
not create or commit `VERCEL_OIDC_TOKEN`.

Redeploy after changing environment variables. If the feature flag is absent, `0`, or `false`,
deterministic normalization still works and AI repair remains disabled.

## Security impact

- Selected input remains capped at 16 KiB per file, 48 KiB total, and 12,000 reported input tokens.
- Output remains capped at 2,000 tokens, twenty text operations, and 64 KiB of patched text.
- Secret-bearing paths and binary files remain excluded before the provider call.
- Customer file contents are explicitly treated as untrusted data, not model instructions.
- Commands, tools, network access, package installation, and AI-generated deployment authority are
  not provided.
- Provider-reported token counts are required; missing counts fail closed.
- Every accepted proposal still passes deterministic patch validation and final project validation.

## Cost impact

Only projects with unresolved allowlisted findings can call AI, at most once per normalization run.
The SDK performs zero automatic model retries. Normal CI never makes a billable call. The opt-in
live test is intentionally separate because it can consume Gateway credits:

```text
pnpm --filter @pocketcloud/worker test:integration:ai
```

Run that command only after the account owner approves the test window and Gateway credit policy.

## Verification

- Worker adapter unit tests cover enablement, prompt hardening, bounded request settings, schema
  output, token accounting, and provider attribution.
- Existing normalizer tests continue to cover patch safety and deterministic final validation.
- The Vercel queue function bundle includes the adapter and loads without credentials at startup.
- Full `pnpm check` and `pnpm build` results belong in the pull request handoff.

## Known limitations

- The external Vercel AI Gateway budget and feature flag are owner-controlled manual gates.
- No live billable generation is run by normal CI or by this implementation without explicit
  account-owner authorization.
- Antivirus, malware reputation, SAST, dependency scanning, and other third-party security engines
  remain the documented post-MVP TODOs.

## Handoff to Builder B

Review the worker runtime injection, the one-call timeout against the 60-second queue Function, and
the unchanged deterministic validator boundary. Builder B may rely on the existing `AiRepairClient`
contract and should not assume the feature is active until the Vercel variable and Gateway budget
are confirmed.

## Merge order

This branch is based on merged `main` through PR #20 and has no unmerged code dependency.
