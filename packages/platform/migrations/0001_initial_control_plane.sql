CREATE TABLE apps (
  id text PRIMARY KEY,
  actor_key text NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  active_version_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artifacts (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('original', 'normalized', 'build_output', 'diagnostic')),
  storage_provider text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  compressed_bytes bigint NOT NULL CHECK (compressed_bytes >= 0),
  expanded_bytes bigint CHECK (expanded_bytes IS NULL OR expanded_bytes >= 0),
  file_count integer CHECK (file_count IS NULL OR file_count >= 0),
  status text NOT NULL CHECK (status IN ('QUARANTINED', 'APPROVED', 'REJECTED', 'DELETED')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artifact_files (
  artifact_id text NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  path text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size bigint NOT NULL CHECK (size >= 0),
  media_type text,
  storage_key text NOT NULL UNIQUE,
  PRIMARY KEY (artifact_id, path)
);

CREATE TABLE app_versions (
  id text PRIMARY KEY,
  app_id text NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  original_artifact_id text UNIQUE REFERENCES artifacts(id) ON DELETE RESTRICT,
  normalized_artifact_id text UNIQUE REFERENCES artifacts(id) ON DELETE RESTRICT,
  project_plan jsonb,
  platform_check_status text NOT NULL DEFAULT 'UPLOADING' CHECK (
    platform_check_status IN (
      'UPLOADING', 'QUARANTINED', 'PLATFORM_CHECKING', 'PLATFORM_REJECTED',
      'PLATFORM_CHECKS_PASSED', 'NORMALIZING', 'READY_TO_DEPLOY', 'DEPLOYED', 'SUSPENDED'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, sequence)
);

ALTER TABLE apps
  ADD CONSTRAINT apps_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES app_versions(id) ON DELETE SET NULL;

CREATE TABLE upload_intents (
  id text PRIMARY KEY,
  actor_key text NOT NULL,
  version_id text NOT NULL UNIQUE REFERENCES app_versions(id) ON DELETE CASCADE,
  planned_artifact_id text NOT NULL UNIQUE,
  storage_key text NOT NULL UNIQUE,
  expected_sha256 text NOT NULL CHECK (expected_sha256 ~ '^[a-f0-9]{64}$'),
  expected_bytes bigint NOT NULL CHECK (expected_bytes BETWEEN 1 AND 10485760),
  content_type text NOT NULL CHECK (content_type = 'application/zip'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'EXPIRED', 'REJECTED')),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deployments (
  id text PRIMARY KEY,
  actor_key text NOT NULL,
  app_id text NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
  version_id text NOT NULL REFERENCES app_versions(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (
    status IN (
      'CREATED', 'UPLOADING', 'QUARANTINED', 'QUEUED', 'CLAIMED', 'SANDBOX_STARTING',
      'ANALYZING', 'NORMALIZING', 'VALIDATING', 'READY_TO_DEPLOY', 'DEPLOYING',
      'VERIFYING', 'READY', 'FAILED', 'CANCELLED', 'SUSPENDED'
    )
  ),
  provider text NOT NULL DEFAULT 'vercel',
  provider_project_id text,
  provider_deployment_id text UNIQUE,
  public_url text,
  idempotency_key text NOT NULL,
  error_code text,
  error_summary text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_key, idempotency_key)
);

CREATE INDEX deployments_actor_status_idx ON deployments(actor_key, status);
CREATE INDEX deployments_created_at_idx ON deployments(created_at);

CREATE TABLE deployment_events (
  id text PRIMARY KEY,
  deployment_id text NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  type text NOT NULL CHECK (type IN ('state', 'progress', 'warning', 'error')),
  code text NOT NULL,
  customer_message text NOT NULL,
  internal_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deployment_id, sequence)
);

CREATE TABLE deployment_event_counters (
  deployment_id text PRIMARY KEY REFERENCES deployments(id) ON DELETE CASCADE,
  next_sequence integer NOT NULL CHECK (next_sequence > 0)
);

CREATE TABLE deployment_jobs (
  id text PRIMARY KEY,
  deployment_id text NOT NULL UNIQUE REFERENCES deployments(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'CLAIMED', 'COMPLETED', 'FAILED', 'CANCELLED')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_by text,
  claim_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (attempt <= max_attempts)
);

CREATE INDEX deployment_jobs_claim_idx ON deployment_jobs(status, available_at, created_at);

CREATE TABLE normalization_changes (
  id text PRIMARY KEY,
  version_id text NOT NULL REFERENCES app_versions(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('deterministic', 'ai')),
  rule_code text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create', 'modify', 'move', 'delete')),
  path text NOT NULL,
  previous_path text,
  before_sha256 text,
  after_sha256 text,
  summary text NOT NULL,
  requires_customer_attention boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usage_events (
  id text PRIMARY KEY,
  actor_key text NOT NULL,
  deployment_id text REFERENCES deployments(id) ON DELETE SET NULL,
  metric text NOT NULL CHECK (
    metric IN (
      'deployment', 'upload_bytes', 'sandbox_creation', 'sandbox_active_milliseconds',
      'sandbox_memory_gb_milliseconds', 'ai_input_tokens', 'ai_output_tokens',
      'provider_deployment'
    )
  ),
  quantity numeric NOT NULL CHECK (quantity >= 0),
  provider text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX usage_events_actor_metric_time_idx ON usage_events(actor_key, metric, created_at);

CREATE TABLE quota_scopes (
  actor_key text PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now()
);
