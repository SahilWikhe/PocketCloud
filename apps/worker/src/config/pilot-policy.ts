export interface PilotWorkerPolicy {
  globalConcurrency: number;
  retentionSweepIntervalMilliseconds: number;
}

function boundedInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

export function pilotWorkerPolicyFromEnvironment(
  environment: NodeJS.ProcessEnv,
): PilotWorkerPolicy {
  return {
    globalConcurrency: boundedInteger(
      "POCKETCLOUD_GLOBAL_CONCURRENCY",
      environment.POCKETCLOUD_GLOBAL_CONCURRENCY,
      3,
      1,
      3,
    ),
    retentionSweepIntervalMilliseconds: boundedInteger(
      "POCKETCLOUD_RETENTION_SWEEP_INTERVAL_MS",
      environment.POCKETCLOUD_RETENTION_SWEEP_INTERVAL_MS,
      5 * 60 * 1_000,
      60 * 1_000,
      24 * 60 * 60 * 1_000,
    ),
  };
}
