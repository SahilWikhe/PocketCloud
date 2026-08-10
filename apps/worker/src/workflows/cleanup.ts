import type {
  DeploymentEventSink,
  DeploymentProvider,
  DeploymentState,
  ExecutionProvider,
} from "@pocketcloud/core";

export interface CleanupRequest {
  deploymentId: string;
  environmentId?: string;
  providerDeploymentId?: string;
  removeProviderDeployment: boolean;
  originalOutcome: DeploymentState;
}

export interface CleanupResult {
  sandboxStopped: boolean;
  providerDeploymentRemoved: boolean;
  failures: readonly ("sandbox" | "provider_deployment")[];
}

export interface CleanupCoordinatorOptions {
  executionProvider: ExecutionProvider;
  deploymentProvider: DeploymentProvider;
  events: DeploymentEventSink;
  now?: () => Date;
}

export class CleanupCoordinator {
  private readonly completed = new Set<string>();
  private readonly tasks = new Map<string, Promise<boolean>>();
  private readonly now: () => Date;

  constructor(private readonly options: CleanupCoordinatorOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async cleanup(request: CleanupRequest): Promise<CleanupResult> {
    const failures: ("sandbox" | "provider_deployment")[] = [];
    let sandboxStopped = request.environmentId === undefined;
    let providerDeploymentRemoved = !request.removeProviderDeployment || request.providerDeploymentId === undefined;
    if (request.environmentId) {
      sandboxStopped = await this.runResource(
        `sandbox:${request.environmentId}`,
        () => this.options.executionProvider.stop(request.environmentId!),
        "sandbox",
        request,
      );
      if (!sandboxStopped) failures.push("sandbox");
    }
    if (request.removeProviderDeployment && request.providerDeploymentId) {
      providerDeploymentRemoved = await this.runResource(
        `deployment:${request.providerDeploymentId}`,
        () => this.options.deploymentProvider.remove(request.providerDeploymentId!),
        "provider_deployment",
        request,
      );
      if (!providerDeploymentRemoved) failures.push("provider_deployment");
    }
    return { sandboxStopped, providerDeploymentRemoved, failures };
  }

  private async runResource(
    key: string,
    operation: () => Promise<void>,
    resourceType: "sandbox" | "provider_deployment",
    request: CleanupRequest,
  ): Promise<boolean> {
    if (this.completed.has(key)) return true;
    const active = this.tasks.get(key);
    if (active) return active;
    const task = (async () => {
      try {
        await operation();
        this.completed.add(key);
        return true;
      } catch (error) {
        await this.options.events.emit({
          schemaVersion: 1,
          deploymentId: request.deploymentId,
          type: "warning",
          code: "CLEANUP_FAILED",
          customerMessage: "PocketCloud recorded a cleanup issue for operator review.",
          internalMetadata: {
            resourceType,
            originalOutcome: request.originalOutcome,
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
          occurredAt: this.now().toISOString(),
        });
        return false;
      }
    })();
    this.tasks.set(key, task);
    try {
      return await task;
    } finally {
      this.tasks.delete(key);
    }
  }
}
