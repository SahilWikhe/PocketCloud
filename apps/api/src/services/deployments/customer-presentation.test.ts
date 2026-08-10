import { readFileSync } from "node:fs";

import {
  pocketCloudErrorCodes,
  pocketCloudErrorCodeSchema,
} from "@pocketcloud/core";
import { describe, expect, it } from "vitest";

// @ts-expect-error PC-200 intentionally keeps its dependency-free fixture catalog in ESM JavaScript.
import { fixtureCatalog } from "../../../../../tests/sample-apps/catalog.mjs";
import {
  customerErrorMatrix,
  presentCustomerError,
  presentCustomerEvent,
} from "./customer-presentation";

const rejectedFixtureCases: [string, string][] = fixtureCatalog
  .filter((fixture: { classification: string }) => fixture.classification === "rejected")
  .map((fixture: { id: string; expectedCode: string }) => [fixture.id, fixture.expectedCode]);

describe("PC-302 customer presentation matrix", () => {
  it("defines canonical copy for every stable PocketCloud error code", () => {
    expect(Object.keys(customerErrorMatrix).sort()).toEqual([...pocketCloudErrorCodes].sort());
    for (const code of pocketCloudErrorCodes) {
      const presentation = presentCustomerError(code);
      expect(presentation.message.length).toBeGreaterThan(12);
      expect(presentation.guidance.length).toBeGreaterThan(12);
    }
  });

  it("documents every stable customer error category", () => {
    const documentation = readFileSync(
      new URL("../../../../../docs/15-customer-failure-matrix.md", import.meta.url),
      "utf8",
    );
    for (const code of pocketCloudErrorCodes) expect(documentation).toContain(`\`${code}\``);
  });

  it.each(rejectedFixtureCases)(
    "gives the rejected PC-200 fixture %s non-retryable guidance",
    (_fixtureId, code) => {
    const parsed = pocketCloudErrorCodeSchema.parse(code);
    expect(presentCustomerError(parsed)).toMatchObject({ retryable: false });
    },
  );

  it("provides actionable rate-limit timing without provider details", () => {
    expect(presentCustomerError("PROVIDER_RATE_LIMITED", { retryAfterSeconds: 125 }))
      .toMatchObject({
        retryable: true,
        retryAfterSeconds: 125,
        guidance: "Try again in about 3 minutes.",
      });
  });

  it("ignores persisted messages for unknown and stable event codes", () => {
    expect(presentCustomerEvent({ type: "error", code: "PROVIDER_DEPLOYMENT_FAILED" }))
      .toBe(customerErrorMatrix.PROVIDER_DEPLOYMENT_FAILED.message);
    expect(presentCustomerEvent({ type: "error", code: "RAW_PROVIDER_LOG" }))
      .toBe("PocketCloud could not complete this deployment.");
  });
});
