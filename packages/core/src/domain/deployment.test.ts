import { describe, expect, it } from "vitest";

import {
  assertDeploymentTransition,
  canTransitionDeployment,
  isTerminalDeploymentState,
} from "./deployment";

describe("deployment state machine", () => {
  it("allows the normal static deployment path", () => {
    const path = [
      "CREATED",
      "UPLOADING",
      "QUARANTINED",
      "QUEUED",
      "CLAIMED",
      "SANDBOX_STARTING",
      "ANALYZING",
      "NORMALIZING",
      "VALIDATING",
      "READY_TO_DEPLOY",
      "DEPLOYING",
      "VERIFYING",
      "READY",
    ] as const;

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransitionDeployment(path[index]!, path[index + 1]!)).toBe(true);
    }
  });

  it("rejects skipped and post-terminal transitions", () => {
    expect(() => assertDeploymentTransition("CREATED", "READY")).toThrow(
      "Invalid deployment transition",
    );
    expect(canTransitionDeployment("READY", "DEPLOYING")).toBe(false);
    expect(isTerminalDeploymentState("READY")).toBe(true);
  });

  it("permits an explicit operator suspension", () => {
    expect(
      canTransitionDeployment("READY", "SUSPENDED", { operatorSuspension: true }),
    ).toBe(true);
    expect(canTransitionDeployment("READY", "SUSPENDED")).toBe(false);
  });
});
