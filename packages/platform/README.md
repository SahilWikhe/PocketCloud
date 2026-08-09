# Platform package

`@pocketcloud/platform` owns PostgreSQL, private object storage, durable jobs, quotas, and
operator audit records. Provider SDK types stay inside this package.

## Neon PostgreSQL

Use Neon's pooled connection string (the hostname normally contains `-pooler`) for API and
worker deployments. `PostgresDatabase` starts with a maximum pool size of five per process and
short idle and connection timeouts so serverless instances do not create an unbounded number
of database connections.

Run migrations with:

```text
pnpm --filter @pocketcloud/platform db:migrate
```

Migrations are applied once, in filename order, and recorded in `pocketcloud_migrations`.
Never edit a migration after it has reached `main`; add a new numbered migration instead.

Repository tests run against an isolated in-process PostgreSQL-compatible PGlite database.
They do not require a developer's Neon database or credentials.

## Builder B integration seams

- `PostgresDeploymentQueue` returns a validated `DeploymentJobV1` and owns claim, heartbeat,
  completion, retry, global concurrency, and one-active-job-per-actor behavior.
- `PlatformArtifactStore` implements the shared `ArtifactStore`, so the worker can retrieve the
  immutable original ZIP and write an approved normalized artifact without importing API code.
- `VercelBlobPrivateObjectStorage` owns private Blob client authorization, reads, writes, and
  deletion. The Vercel SDK does not leak through public PocketCloud contracts.
