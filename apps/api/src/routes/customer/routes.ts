import type { FastifyInstance } from "fastify";

import type {
  CustomerContextService,
  CustomerIdentityProvider,
} from "../../auth/customer";
import type { DashboardService } from "../../services/dashboard/dashboard-service";
import type { CustomerLifecycleService } from "../../services/lifecycle/customer-lifecycle-service";

export interface CustomerRoutesOptions {
  context: CustomerContextService;
  identity: CustomerIdentityProvider;
  dashboard: DashboardService;
  lifecycle?: CustomerLifecycleService;
}

function idempotencyKey(headers: Record<string, unknown>): string {
  const value = headers["idempotency-key"];
  return typeof value === "string" ? value : "";
}

export function registerCustomerRoutes(app: FastifyInstance, options: CustomerRoutesOptions): void {
  app.get("/v1/customer/session", async (request) => {
    const context = await options.context.require(request, options.identity);
    return options.dashboard.session(context);
  });

  app.get("/v1/customer/dashboard", async (request) => {
    const context = await options.context.require(request, options.identity);
    return options.dashboard.get(context);
  });

  if (!options.lifecycle) return;

  app.post<{ Params: { appId: string } }>(
    "/v1/customer/apps/:appId/redeploy",
    async (request, reply) => {
      const context = await options.context.require(request, options.identity);
      const result = await options.lifecycle!.redeploy(
        context,
        request.params.appId,
        idempotencyKey(request.headers),
      );
      return reply.status(202).send(result);
    },
  );

  app.post<{ Params: { appId: string } }>(
    "/v1/customer/apps/:appId/suspend",
    async (request) => {
      const context = await options.context.require(request, options.identity);
      return options.lifecycle!.suspend(
        context,
        request.params.appId,
        idempotencyKey(request.headers),
      );
    },
  );

  app.post<{ Params: { appId: string } }>(
    "/v1/customer/apps/:appId/restore",
    async (request, reply) => {
      const context = await options.context.require(request, options.identity);
      const result = await options.lifecycle!.restore(
        context,
        request.params.appId,
        idempotencyKey(request.headers),
      );
      return reply.status(202).send(result);
    },
  );

  app.delete<{ Params: { appId: string } }>(
    "/v1/customer/apps/:appId",
    async (request) => {
      const context = await options.context.require(request, options.identity);
      return options.lifecycle!.delete(
        context,
        request.params.appId,
        idempotencyKey(request.headers),
      );
    },
  );
}
