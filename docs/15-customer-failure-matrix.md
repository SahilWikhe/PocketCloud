# Customer Success and Failure Matrix

## Purpose

This document defines the PC-302 customer presentation boundary. PocketCloud returns a verified
URL and safe normalization summaries on success. On failure, the API converts stable error codes
to canonical messages and guidance rather than returning persisted exception text, provider logs,
source fragments, credentials, paths, or internal event metadata.

The executable source of truth is
`apps/api/src/services/deployments/customer-presentation.ts`. Its exhaustive TypeScript record and
tests fail when a stable `PocketCloudErrorCode` is added without customer copy.

## Success response

A deployment may expose `publicUrl` only in `READY`. The response also includes the ordered
`NormalizationChangeV1` records for that version. Each change contains hashes and a safe summary,
never file contents. The dashboard displays the verified link and each change summary.

## Failure matrix

| Stable code | Default retry | Customer explanation and next action |
|---|---:|---|
| `REQUEST_INVALID` | No | Check the submitted information and try again. |
| `NOT_FOUND` | No | Return to the dashboard and choose an available item. |
| `UNAUTHORIZED` | No | Check operator/customer access before retrying. |
| `CONFLICT` | No | Refresh the current state before another action. |
| `UPLOAD_INVALID` | No | Create and upload a new ZIP. |
| `UPLOAD_LIMIT_EXCEEDED` | No | Reduce the compressed ZIP to 10 MB or less. |
| `ARTIFACT_INCOMPLETE` | No | Finish or restart the upload before deploying. |
| `STORAGE_FAILED` | Yes | Wait briefly and retry the private upload operation. |
| `ARCHIVE_LIMIT_EXCEEDED` | No | Reduce expanded bytes, file count, individual size, or depth. |
| `ARCHIVE_UNSAFE_PATH` | No | Remove absolute paths, parent traversal, and file links. |
| `FILE_TYPE_NOT_ALLOWED` | No | Remove executable, secret-bearing, nested archive, or unsupported files. |
| `PROJECT_UNSUPPORTED` | No | Keep one supported static site in the ZIP. |
| `ENTRYPOINT_MISSING` | No | Add `index.html` at root or inside one wrapper folder. |
| `NORMALIZATION_FAILED` | No | Fix the reported project issue locally and upload a new ZIP. |
| `AI_BUDGET_EXCEEDED` | No | Reduce the selected text or repair it locally. |
| `AI_PATCH_REJECTED` | No | Repair the issue locally; the proposed patch was not accepted. |
| `VALIDATION_FAILED` | No | Correct the final platform-check issue and upload again. |
| `PROVIDER_RATE_LIMITED` | Yes | PocketCloud retries automatically; otherwise retry after the supplied delay. |
| `PROVIDER_DEPLOYMENT_FAILED` | Persisted value | Retry only when the recorded provider classification allows it. |
| `VERIFICATION_FAILED` | Persisted value | Retry when offered or verify the static entry page loads normally. |
| `INTERNAL_RETRYABLE` | Yes | PocketCloud retries automatically within the durable job budget. |
| `DEPLOYMENT_RATE_LIMITED` | Yes | Wait for the `Retry-After` delay before trying again. |
| `DEPLOYMENT_SUSPENDED` | No | Contact an operator; automatic retry is not allowed. |

The database stores the worker's exact `retryable` and `retryAfterSeconds` values for terminal
failures. The API uses those values with canonical copy, so provider failures are not guessed from
the code alone.

## Event boundary

The API allowlists customer progress and error event codes. Known codes receive canonical text;
unknown error or warning codes receive a generic safe message. Stored `customer_message` remains
useful for internal diagnosis but is not trusted as an API response. `internal_metadata` is never
included in the customer event schema.

## Fixture coverage

Rejected PC-200 fixtures drive the PC-302 matrix test. Archive and deterministic policy fixtures
must resolve to non-retryable presentations. Provider timing, exhaustive code coverage, success
rendering, explicit guidance, and secret/source/log exclusion have separate API and web tests.
