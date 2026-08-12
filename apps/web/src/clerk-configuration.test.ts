import { describe, expect, it } from "vitest";

import { resolveClerkPublishableKey } from "./clerk-configuration";

describe("Clerk browser configuration", () => {
  it("prefers the gopocketcloud Marketplace variable", () => {
    expect(
      resolveClerkPublishableKey({
        NEXT_PUBLIC_gopocketcloud_CLERK_PUBLISHABLE_KEY: "pk_live_gopocketcloud",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_previous",
      }),
    ).toBe("pk_live_gopocketcloud");
  });

  it("keeps the standard Clerk aliases as fallbacks", () => {
    expect(
      resolveClerkPublishableKey({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_standard",
      }),
    ).toBe("pk_test_standard");
  });
});
