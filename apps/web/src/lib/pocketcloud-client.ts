import { upload } from "@vercel/blob/client";
import {
  completedUploadV1Schema,
  customerErrorResponseV1Schema,
  deploymentCreatedV1Schema,
  deploymentStatusV1Schema,
  maximumMvpUploadBytes,
  uploadIntentV1Schema,
  type DeploymentState,
  type DeploymentStatusV1,
} from "@pocketcloud/core";

export interface ProgressUpdate {
  message: string;
  uploadPercentage?: number;
  deploymentState?: DeploymentState;
}

export interface PocketCloudClientLike {
  deploy(
    file: File,
    appName: string,
    onProgress: (update: ProgressUpdate) => void,
  ): Promise<DeploymentStatusV1>;
}

export class CustomerApiError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "CustomerApiError";
    this.retryable = retryable;
  }
}

function getActorId(): string {
  const storageKey = "pocketcloud.prototype.actor";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }
  const actor = crypto.randomUUID();
  window.localStorage.setItem(storageKey, actor);
  return actor;
}

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function parseResponse(response: Response): Promise<unknown> {
  const body = await response.json();
  if (!response.ok) {
    const parsed = customerErrorResponseV1Schema.safeParse(body);
    if (parsed.success) {
      throw new CustomerApiError(parsed.data.error.message, parsed.data.error.retryable);
    }
    throw new CustomerApiError("PocketCloud could not complete that request.", true);
  }
  return body;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function fallbackProgressMessage(status: DeploymentState): string {
  switch (status) {
    case "CREATED":
    case "UPLOADING":
    case "QUARANTINED":
    case "QUEUED":
    case "CLAIMED":
    case "SANDBOX_STARTING":
    case "ANALYZING":
      return "Checking your project";
    case "NORMALIZING":
      return "Fixing issues";
    case "VALIDATING":
    case "READY_TO_DEPLOY":
      return "Preparing deployment";
    case "DEPLOYING":
      return "Publishing";
    case "VERIFYING":
      return "Final check";
    case "READY":
      return "App ready";
    case "FAILED":
      return "Deployment failed";
    case "CANCELLED":
      return "Deployment cancelled";
    case "SUSPENDED":
      return "App suspended";
  }
}

export class PocketCloudClient implements PocketCloudClientLike {
  constructor(private readonly apiBaseUrl = "") {}

  async deploy(
    file: File,
    appName: string,
    onProgress: (update: ProgressUpdate) => void,
  ): Promise<DeploymentStatusV1> {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      throw new CustomerApiError("Choose a ZIP file containing your static website.", false);
    }
    if (file.size > maximumMvpUploadBytes) {
      throw new CustomerApiError("Your ZIP must be 10 MB or smaller.", false);
    }

    const actorId = getActorId();
    const actorHeaders = { "x-pocketcloud-actor": actorId };
    onProgress({ message: "Preparing your upload" });
    const sha256 = await fileSha256(file);
    const intentResponse = await fetch(`${this.apiBaseUrl}/v1/uploads/intents`, {
      method: "POST",
      headers: { "content-type": "application/json", ...actorHeaders },
      body: JSON.stringify({
        schemaVersion: 1,
        appName,
        fileName: file.name,
        size: file.size,
        sha256,
      }),
    });
    const intent = uploadIntentV1Schema.parse(await parseResponse(intentResponse));

    onProgress({ message: "Uploading your ZIP", uploadPercentage: 0 });
    await upload(intent.upload.pathname, file, {
      access: intent.upload.access,
      handleUploadUrl: `${this.apiBaseUrl}${intent.upload.authorizationUrl}`,
      clientPayload: intent.uploadId,
      contentType: intent.upload.contentType,
      multipart: false,
      headers: actorHeaders,
      onUploadProgress(progress) {
        onProgress({ message: "Uploading your ZIP", uploadPercentage: progress.percentage });
      },
    });

    const completionResponse = await fetch(
      `${this.apiBaseUrl}/v1/uploads/${intent.uploadId}/complete`,
      { method: "POST", headers: actorHeaders },
    );
    completedUploadV1Schema.parse(await parseResponse(completionResponse));

    onProgress({ message: "Upload received", deploymentState: "QUARANTINED" });
    const deploymentResponse = await fetch(`${this.apiBaseUrl}/v1/deployments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        ...actorHeaders,
      },
      body: JSON.stringify({ schemaVersion: 1, versionId: intent.versionId }),
    });
    const deployment = deploymentCreatedV1Schema.parse(await parseResponse(deploymentResponse));

    while (true) {
      const statusResponse = await fetch(
        `${this.apiBaseUrl}/v1/deployments/${deployment.deploymentId}`,
        { headers: actorHeaders },
      );
      const status = deploymentStatusV1Schema.parse(await parseResponse(statusResponse));
      const latestEvent = status.events.at(-1);
      onProgress({
        message: latestEvent?.customerMessage ?? fallbackProgressMessage(status.status),
        deploymentState: status.status,
      });
      if (["READY", "FAILED", "CANCELLED", "SUSPENDED"].includes(status.status)) {
        return status;
      }
      await wait(2_000);
    }
  }
}
