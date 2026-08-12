import { createHash } from "node:crypto";

import {
  PocketCloudError,
  type CompletedUploadV1,
  type CreateUploadIntentV1,
  type UploadIntentV1,
} from "@pocketcloud/core";
import {
  AppRepository,
  ArtifactFileRepository,
  ArtifactRepository,
  type ClientUploadAuthorization,
  type ClientUploadAuthorizationRequest,
  type PrivateObjectStorage,
  type TransactionalSqlExecutor,
  UploadIntentRepository,
  UsageRepository,
  VersionRepository,
} from "@pocketcloud/platform";

import { defaultIdFactory, type IdFactory } from "../ids";

const uploadLifetimeMilliseconds = 10 * 60 * 1000;

export interface UploadServiceOptions {
  database: TransactionalSqlExecutor;
  storage: PrivateObjectStorage;
  authorizationUrl?: string;
  idFactory?: IdFactory;
  now?: () => Date;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "untitled-app";
}

async function sha256(chunks: AsyncIterable<Uint8Array>): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of chunks) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export class UploadService {
  private readonly database: TransactionalSqlExecutor;
  private readonly storage: PrivateObjectStorage;
  private readonly authorizationUrl: string;
  private readonly ids: IdFactory;
  private readonly now: () => Date;

  constructor(options: UploadServiceOptions) {
    this.database = options.database;
    this.storage = options.storage;
    this.authorizationUrl = options.authorizationUrl ?? "/v1/uploads/blob";
    this.ids = options.idFactory ?? defaultIdFactory;
    this.now = options.now ?? (() => new Date());
  }

  async createIntent(
    actorKey: string,
    input: CreateUploadIntentV1,
    workspaceId?: string,
  ): Promise<UploadIntentV1> {
    const uploadId = this.ids.create("upl");
    const versionId = this.ids.create("ver");
    const plannedArtifactId = this.ids.create("art");
    const newAppId = this.ids.create("app");
    const storageKey = `quarantine/${plannedArtifactId}/upload.zip`;
    const expiresAt = new Date(this.now().getTime() + uploadLifetimeMilliseconds).toISOString();

    const result = await this.database.transaction(async (transaction) => {
      const apps = new AppRepository(transaction);
      const versions = new VersionRepository(transaction);
      const uploads = new UploadIntentRepository(transaction);

      let appId = input.appId;
      if (appId) {
        const app = await apps.findById(appId);
        if (!app || app.actorKey !== actorKey) {
          throw new PocketCloudError({
            code: "NOT_FOUND",
            customerMessage: "That app could not be found.",
            retryable: false,
          });
        }
        if (app.status !== "ACTIVE") {
          throw new PocketCloudError({
            code: "DEPLOYMENT_SUSPENDED",
            customerMessage: "This app is suspended and cannot accept new uploads.",
            retryable: false,
          });
        }
      } else {
        appId = newAppId;
        await apps.create({
          id: appId,
          actorKey,
          ...(workspaceId === undefined ? {} : { workspaceId }),
          name: input.appName,
          slug: `${slugify(input.appName)}-${appId.slice(-8).toLowerCase()}`,
        });
      }

      await versions.createPending({ id: versionId, appId });
      await uploads.create({
        id: uploadId,
        actorKey,
        versionId,
        plannedArtifactId,
        storageKey,
        expectedSha256: input.sha256.toLowerCase(),
        expectedBytes: input.size,
        expiresAt,
      });

      return { appId };
    });

    return {
      schemaVersion: 1,
      uploadId,
      appId: result.appId,
      versionId,
      plannedArtifactId,
      upload: {
        strategy: "direct_client",
        provider: "vercel_blob",
        pathname: storageKey,
        authorizationUrl: this.authorizationUrl,
        access: "private",
        contentType: "application/zip",
        maximumSizeInBytes: input.size,
        expiresAt,
      },
    };
  }

  async authorizeClientUpload(
    actorKey: string,
    request: ClientUploadAuthorizationRequest,
  ): Promise<ClientUploadAuthorization> {
    if (!request.clientPayload) {
      throw new PocketCloudError({
        code: "UPLOAD_INVALID",
        customerMessage: "The upload authorization is missing.",
        retryable: false,
      });
    }
    const intent = await new UploadIntentRepository(this.database).findById(request.clientPayload);
    if (
      !intent ||
      intent.actorKey !== actorKey ||
      intent.storageKey !== request.pathname ||
      intent.status !== "PENDING" ||
      Date.parse(intent.expiresAt) <= this.now().getTime()
    ) {
      throw new PocketCloudError({
        code: "UPLOAD_INVALID",
        customerMessage: "This upload authorization is invalid or has expired.",
        retryable: false,
      });
    }
    return {
      uploadId: intent.id,
      pathname: intent.storageKey,
      contentType: "application/zip",
      maximumSizeInBytes: intent.expectedBytes,
      validUntil: Date.parse(intent.expiresAt),
    };
  }

  async complete(actorKey: string, uploadId: string): Promise<CompletedUploadV1> {
    const uploads = new UploadIntentRepository(this.database);
    const intent = await uploads.findById(uploadId);
    if (!intent || intent.actorKey !== actorKey) {
      throw new PocketCloudError({
        code: "NOT_FOUND",
        customerMessage: "That upload could not be found.",
        retryable: false,
      });
    }

    const version = await new VersionRepository(this.database).findById(intent.versionId);
    if (!version) {
      throw new PocketCloudError({
        code: "NOT_FOUND",
        customerMessage: "That upload could not be found.",
        retryable: false,
      });
    }
    if (intent.status === "COMPLETED" && version.originalArtifactId) {
      return {
        schemaVersion: 1,
        uploadId,
        appId: version.appId,
        versionId: version.id,
        artifactId: version.originalArtifactId,
        status: "QUARANTINED",
      };
    }
    if (intent.status !== "PENDING" || Date.parse(intent.expiresAt) <= this.now().getTime()) {
      throw new PocketCloudError({
        code: "UPLOAD_INVALID",
        customerMessage: "This upload is no longer available.",
        retryable: false,
      });
    }

    const metadata = await this.storage.stat(intent.storageKey);
    if (!metadata || metadata.size !== intent.expectedBytes || metadata.contentType !== intent.contentType) {
      await uploads.reject(uploadId);
      throw new PocketCloudError({
        code: "UPLOAD_INVALID",
        customerMessage: "The uploaded ZIP did not match the upload request.",
        retryable: false,
      });
    }
    const actualSha256 = await sha256(this.storage.read(intent.storageKey));
    if (actualSha256 !== intent.expectedSha256) {
      await uploads.reject(uploadId);
      await this.storage.delete(intent.storageKey);
      throw new PocketCloudError({
        code: "UPLOAD_INVALID",
        customerMessage: "The uploaded ZIP failed its integrity check.",
        retryable: false,
      });
    }

    return this.database.transaction(async (transaction) => {
      const transactionalUploads = new UploadIntentRepository(transaction);
      const locked = await transactionalUploads.findByIdForUpdate(uploadId);
      const versions = new VersionRepository(transaction);
      const currentVersion = await versions.findById(intent.versionId);
      if (!locked || !currentVersion) {
        throw new PocketCloudError({
          code: "NOT_FOUND",
          customerMessage: "That upload could not be found.",
          retryable: false,
        });
      }
      if (locked.status === "COMPLETED" && currentVersion.originalArtifactId) {
        return {
          schemaVersion: 1 as const,
          uploadId,
          appId: currentVersion.appId,
          versionId: currentVersion.id,
          artifactId: currentVersion.originalArtifactId,
          status: "QUARANTINED" as const,
        };
      }

      await new ArtifactRepository(transaction).insert({
        id: locked.plannedArtifactId,
        kind: "original",
        storageProvider: this.storage.provider,
        storageKey: locked.storageKey,
        sha256: actualSha256,
        compressedBytes: metadata.size,
        status: "QUARANTINED",
        expiresAt: new Date(this.now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await new ArtifactFileRepository(transaction).insert({
        artifactId: locked.plannedArtifactId,
        path: "upload.zip",
        sha256: actualSha256,
        size: metadata.size,
        mediaType: "application/zip",
        storageKey: locked.storageKey,
      });
      const sealed = await versions.sealOriginalArtifact({
        versionId: locked.versionId,
        artifactId: locked.plannedArtifactId,
      });
      const completed = await transactionalUploads.markCompleted(uploadId);
      if (!sealed || !completed) {
        throw new Error("Upload completion lost its database precondition");
      }
      await new UsageRepository(transaction).record({
        id: this.ids.create("use"),
        actorKey,
        metric: "upload_bytes",
        quantity: metadata.size,
      });

      return {
        schemaVersion: 1,
        uploadId,
        appId: sealed.appId,
        versionId: sealed.id,
        artifactId: locked.plannedArtifactId,
        status: "QUARANTINED",
      };
    });
  }
}
