import { z } from "zod";

export const deploymentStates = [
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
  "FAILED",
  "CANCELLED",
  "SUSPENDED",
] as const;

export const deploymentStateSchema = z.enum(deploymentStates);
export type DeploymentState = z.infer<typeof deploymentStateSchema>;

export const terminalDeploymentStates = ["READY", "FAILED", "CANCELLED", "SUSPENDED"] as const;

const ordinaryTransitions: Record<DeploymentState, readonly DeploymentState[]> = {
  CREATED: ["UPLOADING", "CANCELLED"],
  UPLOADING: ["QUARANTINED", "FAILED", "CANCELLED"],
  QUARANTINED: ["QUEUED", "FAILED", "CANCELLED"],
  QUEUED: ["CLAIMED", "FAILED", "CANCELLED"],
  CLAIMED: ["SANDBOX_STARTING", "QUEUED", "FAILED", "CANCELLED"],
  SANDBOX_STARTING: ["ANALYZING", "FAILED", "CANCELLED"],
  ANALYZING: ["NORMALIZING", "FAILED", "CANCELLED"],
  NORMALIZING: ["VALIDATING", "FAILED", "CANCELLED"],
  VALIDATING: ["READY_TO_DEPLOY", "FAILED", "CANCELLED"],
  READY_TO_DEPLOY: ["DEPLOYING", "FAILED", "CANCELLED"],
  DEPLOYING: ["VERIFYING", "FAILED", "CANCELLED"],
  VERIFYING: ["READY", "FAILED", "CANCELLED"],
  READY: [],
  FAILED: [],
  CANCELLED: [],
  SUSPENDED: [],
};

export function isTerminalDeploymentState(state: DeploymentState): boolean {
  return terminalDeploymentStates.includes(state as (typeof terminalDeploymentStates)[number]);
}

export function canTransitionDeployment(
  from: DeploymentState,
  to: DeploymentState,
  options: { operatorSuspension?: boolean } = {},
): boolean {
  if (options.operatorSuspension && to === "SUSPENDED" && from !== "SUSPENDED") {
    return true;
  }

  return ordinaryTransitions[from].includes(to);
}

export function assertDeploymentTransition(
  from: DeploymentState,
  to: DeploymentState,
  options: { operatorSuspension?: boolean } = {},
): void {
  if (!canTransitionDeployment(from, to, options)) {
    throw new Error(`Invalid deployment transition: ${from} -> ${to}`);
  }
}
