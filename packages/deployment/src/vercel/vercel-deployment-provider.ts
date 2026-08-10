import { createHash } from "node:crypto";

import {
  artifactManifestV1Schema,
  identifierSchema,
  PocketCloudError,
  type ArtifactFile,
  type DeployableArtifact,
  type DeploymentProvider,
  type ProviderDeployment,
  type ProviderDeploymentStatus,
  type ProviderLog,
} from "@pocketcloud/core";
import { archivePolicy } from "@pocketcloud/core/execution";
import { Vercel } from "@vercel/sdk";

interface VercelUploadRequest {
  teamId?: string;
  contentLength: number;
  xVercelDigest: string;
  requestBody: Uint8Array;
}

interface VercelCreateRequest {
  teamId?: string;
  skipAutoDetectionConfirmation: "1";
  requestBody: {
    name: string;
    project?: string;
    files: { file: string; sha: string; size: number }[];
    meta: Record<string, string>;
    projectSettings: { framework: null; buildCommand: null; installCommand: null; outputDirectory: null; rootDirectory: null };
  };
}

interface VercelDeploymentSdk {
  uploadFile(request: VercelUploadRequest, options?: { timeoutMs?: number }): Promise<unknown>;
  createDeployment(
    request: VercelCreateRequest,
    options?: { timeoutMs?: number; headers?: Record<string, string> },
  ): Promise<{ id: string; url?: string; alias?: string[]; projectId?: string }>;
  getDeployments(
    request: { teamId?: string; projectId?: string; app?: string; limit: number },
    options?: { timeoutMs?: number },
  ): Promise<{ deployments: { uid: string; url: string }[] }>;
  getDeployment(
    request: { idOrUrl: string; teamId?: string },
    options?: { timeoutMs?: number },
  ): Promise<{ readyState: string }>;
  getDeploymentEvents(
    request: { idOrUrl: string; teamId?: string; direction: "forward"; follow: 0; limit: number; builds: 1 },
    options?: { timeoutMs?: number; acceptHeaderOverride?: "application/json" },
  ): Promise<unknown>;
  cancelDeployment(
    request: { id: string; teamId?: string },
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
  deleteDeployment(
    request: { id: string; teamId?: string },
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
}

type UploadVercelFile = VercelDeploymentSdk["uploadFile"];

export interface VercelDeploymentProviderOptions {
  token: string;
  projectName: string;
  projectId?: string;
  teamId?: string;
  requestTimeoutMilliseconds?: number;
  sdk?: VercelDeploymentSdk;
  now?: () => number;
}

const defaultRequestTimeoutMilliseconds = 30_000;
const maximumLogEvents = 200;
const maximumLogMessageCharacters = 4_096;
const platformVercelConfiguration = new TextEncoder().encode(JSON.stringify({
  framework: null,
  headers: [{
    source: "/(.*)",
    headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      {
        key: "Content-Security-Policy",
        value: "default-src 'self'; base-uri 'none'; child-src 'none'; connect-src 'none'; font-src 'self' data:; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; img-src 'self' data: blob:; media-src 'self'; navigate-to 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:",
      },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ],
  }],
}));

function requestInvalid(message: string): PocketCloudError {
  return new PocketCloudError({ code: "REQUEST_INVALID", customerMessage: message, retryable: false });
}

function artifactIncomplete(): PocketCloudError {
  return new PocketCloudError({
    code: "ARTIFACT_INCOMPLETE",
    customerMessage: "The approved deployment artifact is incomplete or inconsistent.",
    retryable: false,
  });
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

function errorHeaders(error: unknown): Headers | undefined {
  if (typeof error !== "object" || error === null || !("headers" in error)) return undefined;
  const value = (error as { headers?: unknown }).headers;
  return value instanceof Headers ? value : undefined;
}

function retryAfterSeconds(error: unknown, now: () => number): number | undefined {
  const headers = errorHeaders(error);
  const retryAfter = headers?.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - now()) / 1_000));
  }
  const reset = Number(headers?.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, Math.ceil(reset - now() / 1_000));
  return undefined;
}

function mapProviderError(error: unknown, now: () => number): PocketCloudError {
  if (error instanceof PocketCloudError) return error;
  const status = statusCode(error);
  if (status === 429) {
    const retryAfter = retryAfterSeconds(error, now);
    return new PocketCloudError({
      code: "PROVIDER_RATE_LIMITED",
      customerMessage: "The deployment provider is busy. Please retry after the suggested delay.",
      retryable: true,
      ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
    });
  }
  return new PocketCloudError({
    code: "PROVIDER_DEPLOYMENT_FAILED",
    customerMessage: status !== undefined && status >= 400 && status < 500
      ? "The deployment provider rejected this deployment. Please review the project and try again."
      : "The deployment provider is temporarily unavailable. Please try again.",
    retryable: status === undefined || status >= 500,
  });
}

function withTeam<T extends object>(value: T, teamId: string | undefined): T & { teamId?: string } {
  return teamId === undefined ? value : { ...value, teamId };
}

async function readAndVerifyFile(input: DeployableArtifact, file: ArtifactFile): Promise<{ bytes: Uint8Array; sha1: string }> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const sha256 = createHash("sha256");
  const sha1 = createHash("sha1");
  try {
    for await (const chunk of input.files.read(file)) {
      if (!(chunk instanceof Uint8Array)) throw artifactIncomplete();
      totalBytes += chunk.byteLength;
      if (totalBytes > file.size || totalBytes > archivePolicy.maximumSingleFileBytes) throw artifactIncomplete();
      const copy = Uint8Array.from(chunk);
      chunks.push(copy);
      sha256.update(copy);
      sha1.update(copy);
    }
  } catch (error) {
    if (error instanceof PocketCloudError) throw error;
    throw new PocketCloudError({
      code: "STORAGE_FAILED",
      customerMessage: "The approved artifact could not be read. Please try again.",
      retryable: true,
    });
  }
  if (totalBytes !== file.size || sha256.digest("hex") !== file.sha256) throw artifactIncomplete();
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, sha1: sha1.digest("hex") };
}

function validateArtifact(input: DeployableArtifact): void {
  const parsed = artifactManifestV1Schema.safeParse(input.manifest);
  if (!parsed.success || (input.manifest.kind !== "normalized" && input.manifest.kind !== "build_output")) {
    throw artifactIncomplete();
  }
  if (
    input.manifest.fileCount === 0 ||
    input.manifest.fileCount > archivePolicy.maximumFileCount ||
    input.manifest.totalBytes > archivePolicy.maximumExpandedBytes ||
    !input.manifest.files.some((file) => file.path === "index.html") ||
    input.manifest.files.some((file) => file.path.toLowerCase() === "vercel.json") ||
    !identifierSchema.safeParse(input.idempotencyKey).success
  ) throw artifactIncomplete();
}

function candidateUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`);
  if (url.protocol !== "https:") throw new Error("Vercel returned a non-HTTPS deployment URL");
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function mapStatus(value: string): ProviderDeploymentStatus {
  if (value === "QUEUED" || value === "INITIALIZING") return "PENDING";
  if (value === "BUILDING") return "BUILDING";
  if (value === "READY") return "READY";
  if (value === "CANCELED") return "CANCELLED";
  if (value === "ERROR" || value === "BLOCKED") return "FAILED";
  throw new Error("Vercel returned an unknown deployment state");
}

function eventTimestamp(event: Record<string, unknown>): number {
  const payload = typeof event.payload === "object" && event.payload !== null
    ? event.payload as Record<string, unknown>
    : undefined;
  const value = event.date ?? event.created ?? payload?.date ?? payload?.created;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value < 1_000_000_000_000 ? value * 1_000 : value;
}

function eventMessage(event: Record<string, unknown>): string | undefined {
  const payload = typeof event.payload === "object" && event.payload !== null
    ? event.payload as Record<string, unknown>
    : undefined;
  const value = event.text ?? payload?.text;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return [...value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/((?:token|secret|password|api[_-]?key)\s*[:=]\s*)[^\s]+/gi, "$1[redacted]")]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint === 9 || codePoint === 10 || codePoint === 13 || (codePoint >= 32 && codePoint !== 127);
    })
    .join("")
    .slice(0, maximumLogMessageCharacters);
}

function eventLevel(event: Record<string, unknown>): ProviderLog["level"] {
  const type = typeof event.type === "string" ? event.type : "";
  const level = typeof event.level === "string" ? event.level : "";
  if (level === "error" || type === "stderr" || type === "fatal") return "error";
  if (level === "warning") return "warning";
  return "info";
}

export class VercelDeploymentProvider implements DeploymentProvider {
  private readonly sdk: VercelDeploymentSdk;
  private readonly uploadFile: UploadVercelFile;
  private readonly teamId: string | undefined;
  private readonly projectId: string | undefined;
  private readonly projectName: string;
  private readonly requestTimeoutMilliseconds: number;
  private readonly now: () => number;
  private readonly removedIds = new Set<string>();
  private readonly removeTasks = new Map<string, Promise<void>>();

  constructor(options: VercelDeploymentProviderOptions) {
    if (typeof options.token !== "string" || options.token.trim() === "") throw requestInvalid("A Vercel access token is required.");
    if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(options.projectName)) throw requestInvalid("The Vercel project name is invalid.");
    const timeout = options.requestTimeoutMilliseconds ?? defaultRequestTimeoutMilliseconds;
    if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 120_000) throw requestInvalid("The provider request timeout is invalid.");
    this.teamId = options.teamId;
    this.projectId = options.projectId;
    this.projectName = options.projectName;
    this.requestTimeoutMilliseconds = timeout;
    this.now = options.now ?? Date.now;
    if (options.sdk) {
      this.sdk = options.sdk;
      this.uploadFile = options.sdk.uploadFile.bind(options.sdk);
    } else {
      this.sdk = new Vercel({ bearerToken: options.token }).deployments as unknown as VercelDeploymentSdk;
      this.uploadFile = async (request, requestOptions) => {
        const url = new URL("https://api.vercel.com/v2/files");
        if (request.teamId) url.searchParams.set("teamId", request.teamId);
        const response = await fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.token}`,
            "content-type": "application/octet-stream",
            "content-length": String(request.contentLength),
            "x-vercel-digest": request.xVercelDigest,
          },
          body: Buffer.from(request.requestBody),
          signal: AbortSignal.timeout(requestOptions?.timeoutMs ?? this.requestTimeoutMilliseconds),
        });
        if (!response.ok) {
          throw Object.assign(new Error(`Vercel file upload failed with status ${response.status}`), {
            statusCode: response.status,
            headers: response.headers,
          });
        }
      };
    }
  }

  async deploy(input: DeployableArtifact): Promise<ProviderDeployment> {
    validateArtifact(input);
    try {
      const files: { file: string; sha: string; size: number }[] = [];
      for (const file of input.manifest.files) {
        const verified = await readAndVerifyFile(input, file);
        await this.uploadFile(withTeam({
          contentLength: verified.bytes.byteLength,
          xVercelDigest: verified.sha1,
          requestBody: verified.bytes,
        }, this.teamId), { timeoutMs: this.requestTimeoutMilliseconds });
        files.push({ file: file.path, sha: verified.sha1, size: file.size });
      }
      const configurationSha1 = createHash("sha1").update(platformVercelConfiguration).digest("hex");
      await this.uploadFile(withTeam({
        contentLength: platformVercelConfiguration.byteLength,
        xVercelDigest: configurationSha1,
        requestBody: platformVercelConfiguration,
      }, this.teamId), { timeoutMs: this.requestTimeoutMilliseconds });
      files.push({ file: "vercel.json", sha: configurationSha1, size: platformVercelConfiguration.byteLength });
      const created = await this.sdk.createDeployment(withTeam({
        skipAutoDetectionConfirmation: "1" as const,
        requestBody: {
          name: this.projectName,
          ...(this.projectId === undefined ? {} : { project: this.projectId }),
          files,
          meta: {
            pocketcloudArtifactId: input.manifest.artifactId,
            pocketcloudIdempotencyKey: input.idempotencyKey,
          },
          projectSettings: {
            framework: null,
            buildCommand: null,
            installCommand: null,
            outputDirectory: null,
            rootDirectory: null,
          },
        },
      }, this.teamId), {
        timeoutMs: this.requestTimeoutMilliseconds,
        headers: { "x-vercel-idempotency-key": input.idempotencyKey },
      });
      if (!identifierSchema.safeParse(created.id).success) throw new Error("Vercel returned an invalid deployment ID");
      const providerProjectId = created.projectId ?? this.projectId;
      let url = candidateUrl(created.url ?? created.alias?.[0]);
      if (url === undefined) {
        const listed = await this.sdk.getDeployments(withTeam({
          ...(providerProjectId === undefined
            ? { app: this.projectName }
            : { projectId: providerProjectId }),
          limit: 20,
        }, this.teamId), { timeoutMs: this.requestTimeoutMilliseconds });
        url = candidateUrl(
          listed.deployments.find((deployment) => deployment.uid === created.id)?.url,
        );
      }
      return {
        provider: "vercel",
        providerDeploymentId: created.id,
        ...(providerProjectId === undefined ? {} : { providerProjectId }),
        ...(url === undefined ? {} : { candidateUrl: url }),
      };
    } catch (error) {
      throw mapProviderError(error, this.now);
    }
  }

  async getStatus(providerDeploymentId: string): Promise<ProviderDeploymentStatus> {
    if (!identifierSchema.safeParse(providerDeploymentId).success) throw requestInvalid("The provider deployment identifier is invalid.");
    try {
      const deployment = await this.sdk.getDeployment(
        withTeam({ idOrUrl: providerDeploymentId }, this.teamId),
        { timeoutMs: this.requestTimeoutMilliseconds },
      );
      return mapStatus(deployment.readyState);
    } catch (error) {
      throw mapProviderError(error, this.now);
    }
  }

  async getLogs(providerDeploymentId: string): Promise<readonly ProviderLog[]> {
    if (!identifierSchema.safeParse(providerDeploymentId).success) throw requestInvalid("The provider deployment identifier is invalid.");
    try {
      const response = await this.sdk.getDeploymentEvents(
        withTeam({ idOrUrl: providerDeploymentId, direction: "forward" as const, follow: 0 as const, limit: maximumLogEvents, builds: 1 as const }, this.teamId),
        { timeoutMs: this.requestTimeoutMilliseconds, acceptHeaderOverride: "application/json" },
      );
      if (!Array.isArray(response)) return [];
      return response
        .filter((event): event is Record<string, unknown> => typeof event === "object" && event !== null)
        .map((event) => ({ event, message: eventMessage(event) }))
        .filter((item): item is { event: Record<string, unknown>; message: string } => item.message !== undefined)
        .map(({ event, message }) => ({
          occurredAt: new Date(eventTimestamp(event)).toISOString(),
          level: eventLevel(event),
          message,
        }));
    } catch (error) {
      throw mapProviderError(error, this.now);
    }
  }

  async cancel(providerDeploymentId: string): Promise<void> {
    if (!identifierSchema.safeParse(providerDeploymentId).success) throw requestInvalid("The provider deployment identifier is invalid.");
    let deploymentStatus: ProviderDeploymentStatus;
    try {
      const deployment = await this.sdk.getDeployment(
        withTeam({ idOrUrl: providerDeploymentId }, this.teamId),
        { timeoutMs: this.requestTimeoutMilliseconds },
      );
      deploymentStatus = mapStatus(deployment.readyState);
    } catch (error) {
      const status = statusCode(error);
      if (status === 404 || status === 410) return;
      throw mapProviderError(error, this.now);
    }
    if (deploymentStatus === "READY" || deploymentStatus === "FAILED" || deploymentStatus === "CANCELLED") return;
    try {
      await this.sdk.cancelDeployment(
        withTeam({ id: providerDeploymentId }, this.teamId),
        { timeoutMs: this.requestTimeoutMilliseconds },
      );
    } catch (error) {
      const status = statusCode(error);
      if (status === 400 || status === 404 || status === 410) return;
      throw mapProviderError(error, this.now);
    }
  }

  async remove(providerDeploymentId: string): Promise<void> {
    if (!identifierSchema.safeParse(providerDeploymentId).success) throw requestInvalid("The provider deployment identifier is invalid.");
    if (this.removedIds.has(providerDeploymentId)) return;
    const existing = this.removeTasks.get(providerDeploymentId);
    if (existing) return existing;
    const task = (async () => {
      try {
        await this.sdk.deleteDeployment(
          withTeam({ id: providerDeploymentId }, this.teamId),
          { timeoutMs: this.requestTimeoutMilliseconds },
        );
        this.removedIds.add(providerDeploymentId);
      } catch (error) {
        const status = statusCode(error);
        if (status === 404 || status === 410) {
          this.removedIds.add(providerDeploymentId);
          return;
        }
        throw mapProviderError(error, this.now);
      }
    })();
    this.removeTasks.set(providerDeploymentId, task);
    try {
      await task;
    } finally {
      this.removeTasks.delete(providerDeploymentId);
    }
  }
}
