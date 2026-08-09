import type { ArtifactKind } from "@pocketcloud/core";
import type { ArtifactFile } from "@pocketcloud/core";

import type { SqlExecutor } from "./client";
import type { ArtifactRecord, ArtifactStatus } from "./models";
import { toIso, toOptionalIso } from "./models";

interface ArtifactRow {
  id: string;
  kind: ArtifactKind;
  storage_provider: string;
  storage_key: string;
  sha256: string;
  compressed_bytes: string | number;
  expanded_bytes: string | number | null;
  file_count: number | null;
  status: ArtifactStatus;
  expires_at: string | Date | null;
  created_at: string | Date;
}

function mapArtifact(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    kind: row.kind,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    sha256: row.sha256,
    compressedBytes: Number(row.compressed_bytes),
    expandedBytes: row.expanded_bytes === null ? null : Number(row.expanded_bytes),
    fileCount: row.file_count,
    status: row.status,
    expiresAt: toOptionalIso(row.expires_at),
    createdAt: toIso(row.created_at),
  };
}

export class ArtifactRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async insert(input: {
    id: string;
    kind: ArtifactKind;
    storageProvider: string;
    storageKey: string;
    sha256: string;
    compressedBytes: number;
    expandedBytes?: number;
    fileCount?: number;
    status: ArtifactStatus;
    expiresAt?: string;
  }): Promise<ArtifactRecord> {
    const result = await this.sql.query<ArtifactRow>(
      `INSERT INTO artifacts (
         id, kind, storage_provider, storage_key, sha256, compressed_bytes,
         expanded_bytes, file_count, status, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        input.id,
        input.kind,
        input.storageProvider,
        input.storageKey,
        input.sha256,
        input.compressedBytes,
        input.expandedBytes ?? null,
        input.fileCount ?? null,
        input.status,
        input.expiresAt ?? null,
      ],
    );
    return mapArtifact(result.rows[0]!);
  }

  async findById(id: string): Promise<ArtifactRecord | null> {
    const result = await this.sql.query<ArtifactRow>("SELECT * FROM artifacts WHERE id = $1", [id]);
    return result.rows[0] ? mapArtifact(result.rows[0]) : null;
  }

  async findByStorageKey(storageKey: string): Promise<ArtifactRecord | null> {
    const result = await this.sql.query<ArtifactRow>(
      "SELECT * FROM artifacts WHERE storage_key = $1",
      [storageKey],
    );
    return result.rows[0] ? mapArtifact(result.rows[0]) : null;
  }
}

interface ArtifactFileRow {
  artifact_id: string;
  path: string;
  sha256: string;
  size: string | number;
  media_type: string | null;
  storage_key: string;
}

export interface StoredArtifactFile extends ArtifactFile {
  artifactId: string;
  storageKey: string;
}

function mapArtifactFile(row: ArtifactFileRow): StoredArtifactFile {
  return {
    artifactId: row.artifact_id,
    path: row.path,
    sha256: row.sha256,
    size: Number(row.size),
    mediaType: row.media_type,
    storageKey: row.storage_key,
  };
}

export class ArtifactFileRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async insert(input: StoredArtifactFile): Promise<StoredArtifactFile> {
    const result = await this.sql.query<ArtifactFileRow>(
      `INSERT INTO artifact_files (artifact_id, path, sha256, size, media_type, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.artifactId,
        input.path,
        input.sha256,
        input.size,
        input.mediaType,
        input.storageKey,
      ],
    );
    return mapArtifactFile(result.rows[0]!);
  }

  async list(artifactId: string): Promise<readonly StoredArtifactFile[]> {
    const result = await this.sql.query<ArtifactFileRow>(
      "SELECT * FROM artifact_files WHERE artifact_id = $1 ORDER BY path",
      [artifactId],
    );
    return result.rows.map(mapArtifactFile);
  }
}
