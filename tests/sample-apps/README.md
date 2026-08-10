# PC-200 Sample Applications

This directory is Builder B's repeatable fixture catalog for archive policy, static-project
analysis, normalization, validation, and worker end-to-end tests. The fixtures contain no real
malware and make no malware-safety claim.

Committed project directories are safe to inspect normally. Hostile ZIPs and files containing
binary bytes under text extensions are created on demand by `archive-fixtures.mjs`. That helper
refuses to write outside a child directory of the operating system's temporary directory. Tests
inspect hostile ZIP central-directory metadata and never extract those archives.

Run the catalog checks with Node 24:

```text
node --test tests/sample-apps/catalog.test.mjs
```

## Committed project fixtures

| Fixture | Expected classification | Expected result |
|---|---|---|
| `valid-root-static` | Accepted | Static plan rooted at `.` with `index.html`; no repair |
| `valid-wrapper-static` | Repairable | Static plan rooted at `website`; deterministic `MOVE_WRAPPER` |
| `missing-index` | Rejected | `ENTRYPOINT_MISSING` during analysis |
| `missing-referenced-image` | Repairable | `MISSING_LOCAL_REFERENCE`; validation fails if unresolved |
| `incorrect-filename-capitalization` | Repairable | Deterministic `FIX_REFERENCE_CAPITALIZATION` |
| `absolute-local-filesystem-path` | Repairable | `LOCAL_ABSOLUTE_PATH`; validation fails if unresolved |
| `localhost-reference` | Repairable | `LOCALHOST_REFERENCE`; validation fails if unresolved |
| `disallowed-executable-extension` | Rejected | `FILE_TYPE_NOT_ALLOWED` during validation |
| `ambiguous-multiple-sites` | Rejected | `PROJECT_UNSUPPORTED`; analyzer must not guess between sites |

## Generated fixtures

| Fixture | Form | Expected result |
|---|---|---|
| `unexpected-binary-text-content` | Directory | `FILE_TYPE_NOT_ALLOWED` for invalid text content |
| `excessive-directory-depth.zip` | ZIP | `ARCHIVE_LIMIT_EXCEEDED` above twelve directories |
| `path-traversal.zip` | ZIP | `ARCHIVE_UNSAFE_PATH` for `../outside.txt` |
| `absolute-path.zip` | ZIP | `ARCHIVE_UNSAFE_PATH` for a root-absolute entry |
| `symlink.zip` | ZIP | `ARCHIVE_UNSAFE_PATH` for a Unix symbolic-link entry |
| `nested-zip.zip` | ZIP | `FILE_TYPE_NOT_ALLOWED` for a nested archive |
| `file-count-limit.zip` | ZIP | `ARCHIVE_LIMIT_EXCEEDED` at 501 files |
| `single-file-size-limit.zip` | ZIP | `ARCHIVE_LIMIT_EXCEEDED` above 10 MiB for one file |
| `expanded-size-limit.zip` | ZIP | `ARCHIVE_LIMIT_EXCEEDED` above 50 MiB expanded |

The machine-readable source of truth is `catalog.mjs`. Later stories should import it instead of
duplicating fixture names or expected classifications.
