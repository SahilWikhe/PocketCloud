import { PocketCloudError } from "@pocketcloud/core";
import type { QuotaSnapshot } from "@pocketcloud/platform";

export interface PrototypeQuotaPolicy {
  hourlyDeployments: number;
  dailyDeployments: number;
  concurrentDeployments: number;
  maximumUploadBytes: number;
}

export const defaultPrototypeQuotaPolicy: PrototypeQuotaPolicy = {
  hourlyDeployments: 5,
  dailyDeployments: 20,
  concurrentDeployments: 1,
  maximumUploadBytes: 10 * 1024 * 1024,
};

export function assertWithinDeploymentQuota(
  snapshot: QuotaSnapshot,
  policy: PrototypeQuotaPolicy,
): void {
  if (snapshot.activeDeployments >= policy.concurrentDeployments) {
    throw new PocketCloudError({
      code: "DEPLOYMENT_RATE_LIMITED",
      customerMessage: "You already have a deployment in progress. Try again after it finishes.",
      retryable: true,
      retryAfterSeconds: 15,
    });
  }
  if (snapshot.hourlyDeployments >= policy.hourlyDeployments) {
    throw new PocketCloudError({
      code: "DEPLOYMENT_RATE_LIMITED",
      customerMessage: "You have reached the hourly deployment limit. Try again later.",
      retryable: true,
      retryAfterSeconds: 60 * 60,
    });
  }
  if (snapshot.dailyDeployments >= policy.dailyDeployments) {
    throw new PocketCloudError({
      code: "DEPLOYMENT_RATE_LIMITED",
      customerMessage: "You have reached the daily deployment limit. Try again tomorrow.",
      retryable: true,
      retryAfterSeconds: 24 * 60 * 60,
    });
  }
}
