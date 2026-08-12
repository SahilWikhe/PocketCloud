import { createHash, randomUUID } from "node:crypto";

import { getAuth } from "@clerk/fastify";
import { PocketCloudError } from "@pocketcloud/core";
import {
  AccountRepository,
  type TransactionalSqlExecutor,
  type UserRecord,
  type WorkspaceRecord,
} from "@pocketcloud/platform";
import type { FastifyRequest } from "fastify";

export interface AuthenticatedCustomer {
  externalUserId: string;
  primaryEmail?: string;
  displayName?: string;
}

export interface CustomerIdentityProvider {
  authenticate(request: FastifyRequest): Promise<AuthenticatedCustomer | null>;
}

export interface CustomerContext {
  user: UserRecord;
  workspace: WorkspaceRecord;
  actorKey: string;
}

export class ClerkCustomerIdentityProvider implements CustomerIdentityProvider {
  async authenticate(request: FastifyRequest): Promise<AuthenticatedCustomer | null> {
    const authentication = getAuth(request);
    if (!authentication.isAuthenticated || !authentication.userId) return null;
    const claims = authentication.sessionClaims;
    const email = typeof claims?.email === "string" ? claims.email : undefined;
    const name = typeof claims?.name === "string" ? claims.name : undefined;
    return {
      externalUserId: authentication.userId,
      ...(email === undefined ? {} : { primaryEmail: email }),
      ...(name === undefined ? {} : { displayName: name }),
    };
  }
}

function workspaceName(customer: AuthenticatedCustomer): string {
  const preferred = customer.displayName?.trim() || customer.primaryEmail?.split("@", 1)[0]?.trim();
  return preferred ? `${preferred.slice(0, 100)}'s workspace` : "My workspace";
}

function workspaceSlug(externalUserId: string): string {
  return `personal-${createHash("sha256").update(externalUserId).digest("hex").slice(0, 24)}`;
}

export class CustomerContextService {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async require(request: FastifyRequest, provider: CustomerIdentityProvider): Promise<CustomerContext> {
    const identity = await provider.authenticate(request);
    if (!identity) {
      throw new PocketCloudError({
        code: "UNAUTHORIZED",
        customerMessage: "Sign in to continue.",
        retryable: false,
      });
    }

    const account = await this.database.transaction(async (transaction) => {
      const accounts = new AccountRepository(transaction);
      const existing = await accounts.findUserWithPersonalWorkspace("clerk", identity.externalUserId);
      if (existing) return existing;

      let user = await accounts.findUser("clerk", identity.externalUserId);
      if (!user) {
        const userId = `usr_${randomUUID()}`;
        user = await accounts.createUser({
          id: userId,
          authProvider: "clerk",
          externalAuthId: identity.externalUserId,
          ...(identity.primaryEmail === undefined ? {} : { primaryEmail: identity.primaryEmail }),
          ...(identity.displayName === undefined ? {} : { displayName: identity.displayName }),
        });
        user ??= await accounts.findUser("clerk", identity.externalUserId);
      }
      if (!user) throw new Error("Authenticated user could not be provisioned");
      await accounts.createPersonalWorkspace({
        id: `wsp_${randomUUID()}`,
        ownerUserId: user.id,
        name: workspaceName(identity),
        slug: workspaceSlug(identity.externalUserId),
      });
      return accounts.findUserWithPersonalWorkspace("clerk", identity.externalUserId);
    });

    if (!account || account.user.status !== "ACTIVE" || account.workspace.status !== "ACTIVE") {
      throw new PocketCloudError({
        code: "UNAUTHORIZED",
        customerMessage: "This account is not available.",
        retryable: false,
      });
    }
    return {
      ...account,
      actorKey: `workspace:${account.workspace.id}`,
    };
  }
}
