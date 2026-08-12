ALTER TABLE apps
  ADD COLUMN suspension_source text CHECK (suspension_source IN ('CUSTOMER', 'OPERATOR')),
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN recoverable_until timestamptz;

UPDATE apps
SET suspension_source = 'OPERATOR'
WHERE status = 'SUSPENDED';

UPDATE apps
SET deleted_at = updated_at,
    recoverable_until = updated_at
WHERE status = 'DELETED';

ALTER TABLE apps
  ADD CONSTRAINT apps_suspension_state_check CHECK (
    (status = 'SUSPENDED' AND suspension_source IS NOT NULL)
    OR (status <> 'SUSPENDED' AND suspension_source IS NULL)
  ),
  ADD CONSTRAINT apps_deletion_state_check CHECK (
    (status = 'DELETED' AND deleted_at IS NOT NULL AND recoverable_until IS NOT NULL)
    OR (status <> 'DELETED' AND deleted_at IS NULL AND recoverable_until IS NULL)
  );

CREATE TABLE customer_app_actions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  app_id text NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('REDEPLOY', 'SUSPEND', 'RESTORE', 'DELETE')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  resulting_app_status text CHECK (resulting_app_status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  deployment_id text REFERENCES deployments(id) ON DELETE SET NULL,
  recoverable_until timestamptz,
  provider_cleanup_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (
    provider_cleanup_status IN ('NOT_REQUIRED', 'PENDING', 'COMPLETED', 'FAILED')
  ),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX customer_app_actions_workspace_time_idx
  ON customer_app_actions(workspace_id, created_at DESC);
CREATE INDEX customer_app_actions_app_time_idx
  ON customer_app_actions(app_id, created_at DESC);
