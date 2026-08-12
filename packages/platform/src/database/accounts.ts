import type { SqlExecutor } from "./client";
import { toIso } from "./models";

export interface UserRecord {
  id: string;
  authProvider: "clerk";
  externalAuthId: string;
  primaryEmail: string | null;
  displayName: string | null;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  kind: "PERSONAL" | "TEAM";
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  planCode: "FREE" | "STARTER" | "BUSINESS" | "ENTERPRISE";
  personalOwnerUserId: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  createdAt: string;
  updatedAt: string;
}

interface UserRow {
  id: string;
  auth_provider: "clerk";
  external_auth_id: string;
  primary_email: string | null;
  display_name: string | null;
  status: UserRecord["status"];
  created_at: string | Date;
  updated_at: string | Date;
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  kind: WorkspaceRecord["kind"];
  status: WorkspaceRecord["status"];
  plan_code: WorkspaceRecord["planCode"];
  personal_owner_user_id: string | null;
  role: WorkspaceRecord["role"];
  created_at: string | Date;
  updated_at: string | Date;
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    authProvider: row.auth_provider,
    externalAuthId: row.external_auth_id,
    primaryEmail: row.primary_email,
    displayName: row.display_name,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    status: row.status,
    planCode: row.plan_code,
    personalOwnerUserId: row.personal_owner_user_id,
    role: row.role,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class AccountRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async findUserWithPersonalWorkspace(
    authProvider: "clerk",
    externalAuthId: string,
  ): Promise<{ user: UserRecord; workspace: WorkspaceRecord } | null> {
    const result = await this.sql.query<{
      user_id: string;
      auth_provider: "clerk";
      external_auth_id: string;
      primary_email: string | null;
      display_name: string | null;
      user_status: UserRecord["status"];
      user_created_at: string | Date;
      user_updated_at: string | Date;
      workspace_id: string;
      workspace_name: string;
      workspace_slug: string;
      workspace_kind: WorkspaceRecord["kind"];
      workspace_status: WorkspaceRecord["status"];
      plan_code: WorkspaceRecord["planCode"];
      personal_owner_user_id: string | null;
      role: WorkspaceRecord["role"];
      workspace_created_at: string | Date;
      workspace_updated_at: string | Date;
    }>(
      `SELECT
         u.id AS user_id, u.auth_provider, u.external_auth_id, u.primary_email, u.display_name,
         u.status AS user_status, u.created_at AS user_created_at,
         u.updated_at AS user_updated_at,
         w.id AS workspace_id, w.name AS workspace_name, w.slug AS workspace_slug,
         w.kind AS workspace_kind,
         w.status AS workspace_status, w.plan_code, w.personal_owner_user_id,
         m.role, w.created_at AS workspace_created_at, w.updated_at AS workspace_updated_at
       FROM users u
       JOIN workspaces w ON w.personal_owner_user_id = u.id
       JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = u.id
       WHERE u.auth_provider = $1 AND u.external_auth_id = $2
         AND m.status = 'ACTIVE'`,
      [authProvider, externalAuthId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      user: mapUser({
        id: row.user_id,
        auth_provider: row.auth_provider,
        external_auth_id: row.external_auth_id,
        primary_email: row.primary_email,
        display_name: row.display_name,
        status: row.user_status,
        created_at: row.user_created_at,
        updated_at: row.user_updated_at,
      }),
      workspace: mapWorkspace({
        id: row.workspace_id,
        name: row.workspace_name,
        slug: row.workspace_slug,
        kind: row.workspace_kind,
        status: row.workspace_status,
        plan_code: row.plan_code,
        personal_owner_user_id: row.personal_owner_user_id,
        role: row.role,
        created_at: row.workspace_created_at,
        updated_at: row.workspace_updated_at,
      }),
    };
  }

  async createUser(input: {
    id: string;
    authProvider: "clerk";
    externalAuthId: string;
    primaryEmail?: string;
    displayName?: string;
  }): Promise<UserRecord | null> {
    const result = await this.sql.query<UserRow>(
      `INSERT INTO users (
         id, auth_provider, external_auth_id, primary_email, display_name
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (auth_provider, external_auth_id) DO NOTHING
       RETURNING *`,
      [
        input.id,
        input.authProvider,
        input.externalAuthId,
        input.primaryEmail ?? null,
        input.displayName ?? null,
      ],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findUser(authProvider: "clerk", externalAuthId: string): Promise<UserRecord | null> {
    const result = await this.sql.query<UserRow>(
      "SELECT * FROM users WHERE auth_provider = $1 AND external_auth_id = $2",
      [authProvider, externalAuthId],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async createPersonalWorkspace(input: {
    id: string;
    ownerUserId: string;
    name: string;
    slug: string;
  }): Promise<void> {
    await this.sql.query(
      `INSERT INTO workspaces (id, name, slug, kind, personal_owner_user_id)
       VALUES ($1, $2, $3, 'PERSONAL', $4)
       ON CONFLICT (personal_owner_user_id) DO NOTHING`,
      [input.id, input.name, input.slug, input.ownerUserId],
    );
    const workspace = await this.sql.query<{ id: string }>(
      "SELECT id FROM workspaces WHERE personal_owner_user_id = $1",
      [input.ownerUserId],
    );
    await this.sql.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'OWNER')
       ON CONFLICT (workspace_id, user_id) DO UPDATE
       SET role = 'OWNER', status = 'ACTIVE', updated_at = now()`,
      [workspace.rows[0]!.id, input.ownerUserId],
    );
  }
}
