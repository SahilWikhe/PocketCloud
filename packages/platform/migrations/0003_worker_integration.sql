CREATE TABLE deployment_worker_checkpoints (
  deployment_id text PRIMARY KEY REFERENCES deployments(id) ON DELETE CASCADE,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checkpoint) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE normalization_changes DROP CONSTRAINT normalization_changes_pkey;
ALTER TABLE normalization_changes ADD PRIMARY KEY (version_id, id);
