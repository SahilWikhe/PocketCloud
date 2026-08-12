import { describe, expect, it } from "vitest";

import { requiredClerkConfiguration } from "./runtime";

describe("production Clerk configuration", () => {
  it("prefers the paired gopocketcloud Marketplace variables", () => {
    expect(
      requiredClerkConfiguration({
        gopocketcloud_CLERK_SECRET_KEY: "sk_live_gopocketcloud",
        NEXT_PUBLIC_gopocketcloud_CLERK_PUBLISHABLE_KEY: "pk_live_gopocketcloud",
        CLERK_SECRET_KEY: "sk_live_previous",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_previous",
      }),
    ).toEqual({
      secretKey: "sk_live_gopocketcloud",
      publishableKey: "pk_live_gopocketcloud",
    });
  });

  it("rejects an incomplete prefixed Clerk configuration", () => {
    expect(() =>
      requiredClerkConfiguration({
        NEXT_PUBLIC_gopocketcloud_CLERK_PUBLISHABLE_KEY: "pk_live_gopocketcloud",
        CLERK_SECRET_KEY: "sk_live_previous",
      }),
    ).toThrow("must be configured together");
  });

  it("keeps standard Clerk variables as fallbacks", () => {
    expect(
      requiredClerkConfiguration({
        CLERK_SECRET_KEY: "sk_test_standard",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_standard",
      }),
    ).toEqual({
      secretKey: "sk_test_standard",
      publishableKey: "pk_test_standard",
    });
  });
});
