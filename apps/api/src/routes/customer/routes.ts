import type { FastifyInstance } from "fastify";

import type {
  CustomerContextService,
  CustomerIdentityProvider,
} from "../../auth/customer";
import type { DashboardService } from "../../services/dashboard/dashboard-service";

export interface CustomerRoutesOptions {
  context: CustomerContextService;
  identity: CustomerIdentityProvider;
  dashboard: DashboardService;
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
}
