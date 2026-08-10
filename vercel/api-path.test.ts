import { describe, expect, it } from "vitest";

import { toFastifyUrl } from "./api-path";

describe("toFastifyUrl", () => {
  it("reconstructs a public API path from the Vercel rewrite parameter", () => {
    expect(toFastifyUrl("/api/v1?path=uploads%2Fintents")).toBe("/v1/uploads/intents");
  });

  it("preserves customer query parameters while removing the routing parameter", () => {
    expect(toFastifyUrl("/api/v1?path=deployments%2Fdep_123&view=summary")).toBe(
      "/v1/deployments/dep_123?view=summary",
    );
  });

  it("continues to support a directly forwarded API URL", () => {
    expect(toFastifyUrl("/api/v1/deployments/dep_123")).toBe("/v1/deployments/dep_123");
  });

  it("falls back to the root path when the request URL is absent", () => {
    expect(toFastifyUrl(undefined)).toBe("/");
  });
});
