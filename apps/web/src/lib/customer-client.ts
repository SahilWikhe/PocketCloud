import {
  customerDashboardV1Schema,
  customerAppActionV1Schema,
  customerErrorResponseV1Schema,
  type CustomerDashboardV1,
  type CustomerAppActionV1,
  type CustomerLifecycleAction,
} from "@pocketcloud/core";

import { CustomerApiError } from "./pocketcloud-client";

export interface CustomerDashboardClient {
  getDashboard(): Promise<CustomerDashboardV1>;
  manageApp(
    appId: string,
    action: CustomerLifecycleAction,
    idempotencyKey: string,
  ): Promise<CustomerAppActionV1>;
}

export class PocketCloudCustomerClient implements CustomerDashboardClient {
  constructor(private readonly apiBaseUrl = "") {}

  async getDashboard(): Promise<CustomerDashboardV1> {
    const response = await fetch(`${this.apiBaseUrl}/v1/customer/dashboard`);
    const body: unknown = await response.json();
    if (!response.ok) {
      const parsed = customerErrorResponseV1Schema.safeParse(body);
      if (parsed.success) {
        throw new CustomerApiError(
          parsed.data.error.message,
          parsed.data.error.retryable,
          parsed.data.error.guidance,
        );
      }
      throw new CustomerApiError("PocketCloud could not load your dashboard.", true);
    }
    return customerDashboardV1Schema.parse(body);
  }

  async manageApp(
    appId: string,
    action: CustomerLifecycleAction,
    idempotencyKey: string,
  ): Promise<CustomerAppActionV1> {
    const suffix = action === "DELETE" ? "" : `/${action.toLowerCase()}`;
    const response = await fetch(`${this.apiBaseUrl}/v1/customer/apps/${appId}${suffix}`, {
      method: action === "DELETE" ? "DELETE" : "POST",
      headers: { "idempotency-key": idempotencyKey },
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const parsed = customerErrorResponseV1Schema.safeParse(body);
      if (parsed.success) {
        throw new CustomerApiError(
          parsed.data.error.message,
          parsed.data.error.retryable,
          parsed.data.error.guidance,
        );
      }
      throw new CustomerApiError("PocketCloud could not update this project.", true);
    }
    return customerAppActionV1Schema.parse(body);
  }
}
