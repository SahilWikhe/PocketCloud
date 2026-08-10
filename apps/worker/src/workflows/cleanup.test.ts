import type { DeploymentEventV1, DeploymentProvider, ExecutionProvider } from "@pocketcloud/core";
import { describe, expect, it, vi } from "vitest";

import { CleanupCoordinator } from "./cleanup";

function dependencies() {
  const stop = vi.fn(async () => undefined);
  const remove = vi.fn(async () => undefined);
  const events: DeploymentEventV1[] = [];
  return {
    stop,
    remove,
    events,
    coordinator: new CleanupCoordinator({
      executionProvider: { stop } as unknown as ExecutionProvider,
      deploymentProvider: { remove } as unknown as DeploymentProvider,
      events: { emit: async (event) => { events.push(event); } },
      now: () => new Date("2026-08-09T20:00:00.000Z"),
    }),
  };
}

describe("CleanupCoordinator", () => {
  it("stops sandbox and removes a failed provider deployment idempotently", async () => {
    const { coordinator, stop, remove } = dependencies();
    const request = {
      deploymentId: "deployment-207",
      environmentId: "sandbox-207",
      providerDeploymentId: "dpl_207",
      removeProviderDeployment: true,
      originalOutcome: "FAILED" as const,
    };
    const [first, second] = await Promise.all([coordinator.cleanup(request), coordinator.cleanup(request)]);
    expect(first.failures).toEqual([]);
    expect(second.failures).toEqual([]);
    await coordinator.cleanup(request);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("logs cleanup failures for operators without throwing or replacing the outcome", async () => {
    const { coordinator, stop, events } = dependencies();
    stop.mockRejectedValueOnce(new Error("provider token=secret-value"));
    await expect(coordinator.cleanup({
      deploymentId: "deployment-207",
      environmentId: "sandbox-207",
      removeProviderDeployment: false,
      originalOutcome: "READY",
    })).resolves.toMatchObject({ sandboxStopped: false, failures: ["sandbox"] });
    expect(events).toEqual([expect.objectContaining({
      type: "warning",
      code: "CLEANUP_FAILED",
      customerMessage: "PocketCloud recorded a cleanup issue for operator review.",
      internalMetadata: { resourceType: "sandbox", originalOutcome: "READY", errorName: "Error" },
    })]);
    expect(JSON.stringify(events)).not.toContain("secret-value");
  });

  it("allows a failed cleanup operation to be retried", async () => {
    const { coordinator, stop } = dependencies();
    stop.mockRejectedValueOnce(new Error("temporary"));
    const request = { deploymentId: "deployment-207", environmentId: "sandbox-207", removeProviderDeployment: false, originalOutcome: "FAILED" as const };
    await coordinator.cleanup(request);
    await expect(coordinator.cleanup(request)).resolves.toMatchObject({ sandboxStopped: true, failures: [] });
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
