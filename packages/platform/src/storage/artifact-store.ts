import { createHash, randomUUID } from "node:crypto";

import {
  artifactFileSchema,
  artifactManifestV1Schema,
  PocketCloudError,
  type ArtifactFile,
  type ArtifactFileChunk,
  type ArtifactManifestV1,
  type ArtifactStore,
  type NewArtifactInput,
} from "@pocketcloud/core";

import { ArtifactFileRepository, ArtifactRepository } from "../database/artifacts";
import type { TransactionalSqlExecutor } from "../database/client";
import type { PrivateObjectStorage } from "./private-object-storage";

const maximumArtifactBytes = 50 * 1024 * 1024;
const maximumArtifactFiles = 500;

interface BufferedFile {
  file: ArtifactFile;
  chunks: Uint8Array[];
  receivedBytes: number;
}

function concatenate(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function hashManifestFiles(files: readonly ArtifactFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.sha256);
    hash.update("\0");
    hash.update(String(file.size));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export interface PlatformArtifactStoreOptions {
  database: TransactionalSqlExecutor;
  storage: PrivateObjectStorage;
  createId?: () => string;
  now?: () => Date;
}

export class PlatformArtifactStore implements ArtifactStore {
  private readonly database: TransactionalSqlExecutor;
  private readonly storage: PrivateObjectStorage;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: PlatformArtifactStoreOptions) {
    this.database = options.database;
    this.storage = options.storage;
    this.createId = options.createId ?? (() => `art_${randomUUID()}`);
    this.now = options.now ?? (() => new Date());
  }

  async getManifest(artifactId: string): Promise<ArtifactManifestV1> {
    const artifact = await new ArtifactRepository(this.database).findById(artifactId);
    if (!artifact || artifact.status === "DELETED") {
      throw new PocketCloudError({
        code: "NOT_FOUND",
        customerMessage: "That artifact could not be found.",
        retryable: false,
      });
    }
    const storedFiles = await new ArtifactFileRepository(this.database).list(artifactId);
    const files = storedFiles.map(({ storageKey: _storageKey, artifactId: _artifactId, ...file }) => file);
    return artifactManifestV1Schema.parse({
      schemaVersion: 1,
      artifactId: artifact.id,
      kind: artifact.kind,
      sha256: artifact.sha256,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
      fileCount: files.length,
      files,
      createdAt: artifact.createdAt,
    });
  }

  async *readFiles(artifactId: string): AsyncIterable<ArtifactFileChunk> {
    const artifact = await new ArtifactRepository(this.database).findById(artifactId);
    if (!artifact || artifact.status === "DELETED") {
      throw new PocketCloudError({
        code: "NOT_FOUND",
        customerMessage: "That artifact could not be found.",
        retryable: false,
      });
    }
    const storedFiles = await new ArtifactFileRepository(this.database).list(artifactId);
    for (const storedFile of storedFiles) {
      const { storageKey, artifactId: _storedArtifactId, ...file } = storedFile;
      let offset = 0;
      for await (const bytes of this.storage.read(storageKey)) {
        yield { file, offset, bytes };
        offset += bytes.byteLength;
      }
      if (offset !== file.size) {
        throw new Error("Stored artifact file size does not match its immutable manifest");
      }
    }
  }

  async writeArtifact(input: NewArtifactInput): Promise<ArtifactManifestV1> {
    if (input.kind === "original") {
      throw new Error("Original artifacts can only be created by the quarantine upload flow");
    }
    const buffered = new Map<string, BufferedFile>();
    let totalBytes = 0;
    for await (const chunk of input.files) {
      const file = artifactFileSchema.parse(chunk.file);
      let entry = buffered.get(file.path);
      if (!entry) {
        if (buffered.size >= maximumArtifactFiles) {
          throw new Error("Artifact file count exceeds the platform limit");
        }
        entry = { file, chunks: [], receivedBytes: 0 };
        buffered.set(file.path, entry);
      }
      if (
        entry.file.sha256 !== file.sha256 ||
        entry.file.size !== file.size ||
        entry.file.mediaType !== file.mediaType ||
        chunk.offset !== entry.receivedBytes
      ) {
        throw new Error("Artifact chunks do not match their declared file manifest");
      }
      entry.chunks.push(chunk.bytes.slice());
      entry.receivedBytes += chunk.bytes.byteLength;
      totalBytes += chunk.bytes.byteLength;
      if (totalBytes > maximumArtifactBytes || entry.receivedBytes > entry.file.size) {
        throw new Error("Artifact bytes exceed the platform limit or declared file size");
      }
    }

    const entries = [...buffered.values()].sort((left, right) =>
      left.file.path.localeCompare(right.file.path),
    );
    if (entries.length === 0) {
      throw new Error("An artifact must contain at least one file");
    }
    for (const entry of entries) {
      if (entry.receivedBytes !== entry.file.size) {
        throw new Error("Artifact file ended before its declared size");
      }
      const bytes = concatenate(entry.chunks, entry.receivedBytes);
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (actualHash !== entry.file.sha256) {
        throw new Error("Artifact file hash does not match its declared manifest");
      }
    }

    const artifactId = this.createId();
    const writtenKeys: string[] = [];
    try {
      for (const entry of entries) {
        const storageKey = `artifacts/${artifactId}/${entry.file.path}`;
        await this.storage.write(
          storageKey,
          concatenate(entry.chunks, entry.receivedBytes),
          entry.file.mediaType ?? "application/octet-stream",
        );
        writtenKeys.push(storageKey);
      }

      const files = entries.map((entry) => entry.file);
      const artifactHash = hashManifestFiles(files);
      await this.database.transaction(async (transaction) => {
        await new ArtifactRepository(transaction).insert({
          id: artifactId,
          kind: input.kind,
          storageProvider: this.storage.provider,
          storageKey: `artifacts/${artifactId}`,
          sha256: artifactHash,
          compressedBytes: totalBytes,
          expandedBytes: totalBytes,
          fileCount: files.length,
          status: "APPROVED",
        });
        const fileRepository = new ArtifactFileRepository(transaction);
        for (const [index, file] of files.entries()) {
          await fileRepository.insert({
            artifactId,
            ...file,
            storageKey: writtenKeys[index]!,
          });
        }
      });

      return artifactManifestV1Schema.parse({
        schemaVersion: 1,
        artifactId,
        kind: input.kind,
        sha256: artifactHash,
        totalBytes,
        fileCount: files.length,
        files,
        createdAt: this.now().toISOString(),
      });
    } catch (error) {
      await Promise.allSettled(writtenKeys.map((storageKey) => this.storage.delete(storageKey)));
      throw error;
    }
  }
}
