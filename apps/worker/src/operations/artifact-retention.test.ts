import {
  ArtifactRepository,
  MemoryPrivateObjectStorage,
  UploadIntentRepository,
} from "@pocketcloud/platform";
import {
  createMigratedTestDatabase,
  type PGliteTestDatabase,
} from "@pocketcloud/platform/testing";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactRetentionService } from "./artifact-retention";

describe("pilot artifact retention", () => {
  let database: PGliteTestDatabase | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it("deletes expired quarantine bytes and preserves durable audit metadata", async () => {
    database = await createMigratedTestDatabase();
    const storage = new MemoryPrivateObjectStorage();
    const now = new Date("2026-08-09T20:00:00.000Z");
    const hash = "a".repeat(64);
    storage.put("quarantine/pending/upload.zip", new Uint8Array([1]));
    storage.put("quarantine/artifact/upload.zip", new Uint8Array([2]));
    await database.query(
      `INSERT INTO apps (id, actor_key, name, slug)
       VALUES ('app-retention', 'actor-retention', 'Retention', 'retention');
       INSERT INTO app_versions (id, app_id, sequence)
       VALUES ('version-retention', 'app-retention', 1);
       INSERT INTO upload_intents (
         id, actor_key, version_id, planned_artifact_id, storage_key, expected_sha256,
         expected_bytes, content_type, status, expires_at
       ) VALUES (
         'upload-expired', 'actor-retention', 'version-retention', 'planned-expired',
         'quarantine/pending/upload.zip',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         1, 'application/zip', 'PENDING', '2026-08-09T19:00:00.000Z'
       );
       INSERT INTO artifacts (
         id, kind, storage_provider, storage_key, sha256, compressed_bytes, status, expires_at
       ) VALUES (
         'artifact-expired', 'original', 'memory', 'quarantine/artifact/upload.zip',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         1, 'QUARANTINED', '2026-08-09T19:00:00.000Z'
       );
       INSERT INTO artifact_files (artifact_id, path, sha256, size, media_type, storage_key)
       VALUES (
         'artifact-expired', 'upload.zip',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         1, 'application/zip',
         'quarantine/artifact/upload.zip'
       )`,
    );

    const result = await new ArtifactRetentionService({
      database,
      storage,
      now: () => now,
    }).runOnce();

    expect(result).toEqual({ expiredUploadIntents: 1, deletedArtifacts: 1, failures: [] });
    expect(await storage.stat("quarantine/pending/upload.zip")).toBeNull();
    expect(await storage.stat("quarantine/artifact/upload.zip")).toBeNull();
    expect(await new UploadIntentRepository(database).findById("upload-expired"))
      .toMatchObject({ status: "EXPIRED" });
    expect(await new ArtifactRepository(database).findById("artifact-expired"))
      .toMatchObject({ status: "DELETED", sha256: hash });
  });
});
