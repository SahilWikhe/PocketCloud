CREATE TABLE users (
  id text PRIMARY KEY,
  auth_provider text NOT NULL CHECK (auth_provider IN ('clerk')),
  external_auth_id text NOT NULL,
  primary_email text,
  display_name text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_provider, external_auth_id)
);

CREATE TABLE workspaces (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  kind text NOT NULL DEFAULT 'PERSONAL' CHECK (kind IN ('PERSONAL', 'TEAM')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  plan_code text NOT NULL DEFAULT 'FREE' CHECK (plan_code IN ('FREE', 'STARTER', 'BUSINESS', 'ENTERPRISE')),
  personal_owner_user_id text UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'PERSONAL' AND personal_owner_user_id IS NOT NULL)
    OR (kind = 'TEAM' AND personal_owner_user_id IS NULL)
  )
);

CREATE TABLE workspace_memberships (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INVITED', 'REMOVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE apps
  ADD COLUMN workspace_id text REFERENCES workspaces(id) ON DELETE RESTRICT;

CREATE INDEX apps_workspace_updated_idx ON apps(workspace_id, updated_at DESC);
CREATE INDEX workspace_memberships_user_idx ON workspace_memberships(user_id, status);
