import {
  ArtifactFileRepository,
  ArtifactRepository,
  type PrivateObjectStorage,
  type SqlExecutor,
  UploadIntentRepository,
} from "@pocketcloud/platform";

export interface ArtifactRetentionLogger {
  warn(message: string, metadata?: Record<string, unknown>): void;
}

export interface ArtifactRetentionResult {
  expiredUploadIntents: number;
  deletedArtifacts: number;
  failures: readonly { resourceType: "upload_intent" | "artifact"; resourceId: string }[];
}

export interface ArtifactRetentionServiceOptions {
  database: SqlExecutor;
  storage: PrivateObjectStorage;
  logger?: ArtifactRetentionLogger;
  now?: () => Date;
}

const silentLogger: ArtifactRetentionLogger = { warn() {} };

export class ArtifactRetentionService {
  private readonly logger: ArtifactRetentionLogger;
  private readonly now: () => Date;

  constructor(private readonly options: ArtifactRetentionServiceOptions) {
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(limit = 100): Promise<ArtifactRetentionResult> {
    const before = this.now().toISOString();
    const uploads = new UploadIntentRepository(this.options.database);
    const artifacts = new ArtifactRepository(this.options.database);
    const artifactFiles = new ArtifactFileRepository(this.options.database);
    const failures: { resourceType: "upload_intent" | "artifact"; resourceId: string }[] = [];
    let expiredUploadIntents = 0;
    let deletedArtifacts = 0;

    for (const upload of await uploads.listExpiredPending(before, limit)) {
      try {
        await this.options.storage.delete(upload.storageKey);
        if (await uploads.markExpired(upload.id, before)) expiredUploadIntents += 1;
      } catch (error) {
        failures.push({ resourceType: "upload_intent", resourceId: upload.id });
        this.logger.warn("Expired upload cleanup failed", {
          resourceType: "upload_intent",
          resourceId: upload.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }

    for (const artifact of await artifacts.listExpired(before, limit)) {
      try {
        const files = await artifactFiles.list(artifact.id);
        const storageKeys = new Set([
          artifact.storageKey,
          ...files.map((file) => file.storageKey),
        ]);
        await Promise.all([...storageKeys].map((storageKey) => this.options.storage.delete(storageKey)));
        if (await artifacts.markDeleted(artifact.id, before)) deletedArtifacts += 1;
      } catch (error) {
        failures.push({ resourceType: "artifact", resourceId: artifact.id });
        this.logger.warn("Expired artifact cleanup failed", {
          resourceType: "artifact",
          resourceId: artifact.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }

    return { expiredUploadIntents, deletedArtifacts, failures };
  }
}
