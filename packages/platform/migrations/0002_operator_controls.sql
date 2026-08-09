CREATE TABLE operator_actions (
  id text PRIMARY KEY,
  app_id text NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
  operator_actor text NOT NULL,
  action text NOT NULL CHECK (action IN ('SUSPEND', 'REENABLE')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  provider_cleanup_status text NOT NULL CHECK (
    provider_cleanup_status IN ('NOT_REQUIRED', 'PENDING', 'COMPLETED', 'FAILED')
  ),
  provider_cleanup_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX operator_actions_app_time_idx ON operator_actions(app_id, created_at);
