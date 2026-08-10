import { describe, expect, it } from "vitest";

import { pilotWorkerPolicyFromEnvironment } from "./pilot-policy";

describe("pilot worker policy", () => {
  it("enables bounded global concurrency and retention sweeps by default", () => {
    expect(pilotWorkerPolicyFromEnvironment({})).toEqual({
      globalConcurrency: 3,
      retentionSweepIntervalMilliseconds: 300_000,
    });
  });

  it("accepts stricter pilot settings", () => {
    expect(pilotWorkerPolicyFromEnvironment({
      POCKETCLOUD_GLOBAL_CONCURRENCY: "1",
      POCKETCLOUD_RETENTION_SWEEP_INTERVAL_MS: "60000",
    })).toEqual({
      globalConcurrency: 1,
      retentionSweepIntervalMilliseconds: 60_000,
    });
  });

  it.each([
    ["POCKETCLOUD_GLOBAL_CONCURRENCY", "4"],
    ["POCKETCLOUD_GLOBAL_CONCURRENCY", "1.5"],
    ["POCKETCLOUD_RETENTION_SWEEP_INTERVAL_MS", "59999"],
  ])("rejects an unsafe %s value", (name, value) => {
    expect(() => pilotWorkerPolicyFromEnvironment({ [name]: value })).toThrow(name);
  });
});
