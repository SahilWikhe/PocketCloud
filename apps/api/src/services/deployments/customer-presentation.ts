import {
  pocketCloudErrorCodeSchema,
  type PocketCloudErrorCode,
} from "@pocketcloud/core";

export interface CustomerErrorPresentation {
  code: PocketCloudErrorCode;
  message: string;
  guidance: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

type CustomerErrorCopy = Omit<CustomerErrorPresentation, "code" | "retryAfterSeconds">;

export const customerErrorMatrix = {
  REQUEST_INVALID: {
    message: "PocketCloud could not use that request.",
    guidance: "Check the information you entered and try again.",
    retryable: false,
  },
  NOT_FOUND: {
    message: "PocketCloud could not find that item.",
    guidance: "Return to your dashboard and choose an available app or deployment.",
    retryable: false,
  },
  UNAUTHORIZED: {
    message: "You are not authorized to perform that action.",
    guidance: "Check your access and sign in again before retrying.",
    retryable: false,
  },
  CONFLICT: {
    message: "That action conflicts with the current deployment state.",
    guidance: "Refresh the deployment status before trying another action.",
    retryable: false,
  },
  UPLOAD_INVALID: {
    message: "PocketCloud could not accept that ZIP upload.",
    guidance: "Create a new ZIP and upload it again.",
    retryable: false,
  },
  UPLOAD_LIMIT_EXCEEDED: {
    message: "The ZIP is larger than the current upload limit.",
    guidance: "Reduce the ZIP to 10 MB or less and upload it again.",
    retryable: false,
  },
  ARTIFACT_INCOMPLETE: {
    message: "The uploaded project is incomplete.",
    guidance: "Finish uploading the ZIP, then start a new deployment.",
    retryable: false,
  },
  STORAGE_FAILED: {
    message: "PocketCloud could not access the private upload store.",
    guidance: "Wait a moment and try the upload again.",
    retryable: true,
  },
  ARCHIVE_LIMIT_EXCEEDED: {
    message: "The ZIP exceeds PocketCloud's archive limits.",
    guidance: "Reduce its expanded size, file count, file size, or directory depth before retrying.",
    retryable: false,
  },
  ARCHIVE_UNSAFE_PATH: {
    message: "The ZIP contains an unsafe file path or link.",
    guidance: "Recreate the ZIP without absolute paths, parent paths, or file links.",
    retryable: false,
  },
  FILE_TYPE_NOT_ALLOWED: {
    message: "The project contains a file type that static deployments do not allow.",
    guidance: "Remove executable, secret-bearing, nested archive, or unsupported files.",
    retryable: false,
  },
  PROJECT_UNSUPPORTED: {
    message: "PocketCloud could not identify one supported static website.",
    guidance: "Keep one static site with a single index.html entry point in the ZIP.",
    retryable: false,
  },
  ENTRYPOINT_MISSING: {
    message: "PocketCloud could not find a supported index.html entry point.",
    guidance: "Add index.html at the ZIP root or inside one wrapper folder.",
    retryable: false,
  },
  NORMALIZATION_FAILED: {
    message: "PocketCloud could not repair this project within the supported rules.",
    guidance: "Fix the reported project issue locally, then upload a new ZIP.",
    retryable: false,
  },
  AI_BUDGET_EXCEEDED: {
    message: "This project exceeds the bounded automated-repair budget.",
    guidance: "Reduce the affected text files or repair the issue locally before retrying.",
    retryable: false,
  },
  AI_PATCH_REJECTED: {
    message: "The proposed automated repair did not pass PocketCloud's rules.",
    guidance: "Repair the reported issue locally, then upload a new ZIP.",
    retryable: false,
  },
  VALIDATION_FAILED: {
    message: "The repaired project did not pass final platform checks.",
    guidance: "Review the reported project issue and upload a corrected ZIP.",
    retryable: false,
  },
  PROVIDER_RATE_LIMITED: {
    message: "Publishing is temporarily busy.",
    guidance: "PocketCloud retries automatically; if it still fails, try again in a few minutes.",
    retryable: true,
  },
  PROVIDER_DEPLOYMENT_FAILED: {
    message: "The approved project could not be published.",
    guidance: "Try again if offered, or contact support with the deployment ID.",
    retryable: false,
  },
  VERIFICATION_FAILED: {
    message: "The published page did not pass its final availability check.",
    guidance: "Try again if offered, or verify that the static entry page can load normally.",
    retryable: true,
  },
  INTERNAL_RETRYABLE: {
    message: "PocketCloud hit a temporary processing problem.",
    guidance: "PocketCloud retries automatically; you can try again if the deployment stops.",
    retryable: true,
  },
  DEPLOYMENT_RATE_LIMITED: {
    message: "You have reached the current deployment limit.",
    guidance: "Wait for the suggested delay, then try again.",
    retryable: true,
  },
  DEPLOYMENT_SUSPENDED: {
    message: "This app is suspended and cannot be deployed.",
    guidance: "Contact the PocketCloud operator if you believe this was a mistake.",
    retryable: false,
  },
} satisfies Record<PocketCloudErrorCode, CustomerErrorCopy>;

function formatDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export function presentCustomerError(
  code: PocketCloudErrorCode,
  options: { retryable?: boolean; retryAfterSeconds?: number } = {},
): CustomerErrorPresentation {
  const copy = customerErrorMatrix[code];
  const retryable = options.retryable ?? copy.retryable;
  const guidance = options.retryAfterSeconds === undefined
    ? copy.guidance
    : `Try again in about ${formatDelay(options.retryAfterSeconds)}.`;
  return {
    code,
    message: copy.message,
    guidance,
    retryable,
    ...(options.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: options.retryAfterSeconds }),
  };
}

const customerEventMessages: Readonly<Record<string, string>> = {
  UPLOAD_RECEIVED: "Upload received",
  QUEUED: "Checking your project",
  CHECKING_PROJECT: "Checking your project",
  ANALYZING_PROJECT: "Checking your project",
  FIXING_PROJECT: "Fixing issues",
  VALIDATING_PROJECT: "Preparing deployment",
  PLATFORM_CHECKS_PASSED: "Preparing deployment",
  PUBLISHING_PROJECT: "Publishing",
  VERIFYING_PROJECT: "Final check",
  DEPLOYMENT_READY: "App ready",
  DEPLOYMENT_FAILED: "PocketCloud could not deploy this project.",
  DEPLOYMENT_CANCELLED: "Deployment cancelled",
  RETRY_SCHEDULED: "PocketCloud will retry this deployment.",
  CLEANUP_FAILED: "PocketCloud recorded a cleanup issue for operator review.",
  DEPLOYMENT_SUSPENDED: "This app has been suspended.",
};

export function presentCustomerEvent(input: {
  type: "state" | "progress" | "warning" | "error";
  code: string;
}): string {
  const known = customerEventMessages[input.code];
  if (known !== undefined) return known;
  const errorCode = pocketCloudErrorCodeSchema.safeParse(input.code);
  if (errorCode.success) return customerErrorMatrix[errorCode.data].message;
  if (input.type === "error") return "PocketCloud could not complete this deployment.";
  if (input.type === "warning") return "PocketCloud recorded an issue and may retry.";
  return "Deployment status updated";
}
