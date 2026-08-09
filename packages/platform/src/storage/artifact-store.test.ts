import { createHash } from "node:crypto";

import type { ArtifactFileChunk } from "@pocketcloud/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMigratedTestDatabase, type PGliteTestDatabase } from "../testing/pglite";
import { PlatformArtifactStore } from "./artifact-store";
import { MemoryPrivateObjectStorage } from "./memory";

describe("PlatformArtifactStore", () => {
  let database: PGliteTestDatabase;
  let storage: MemoryPrivateObjectStorage;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    storage = new MemoryPrivateObjectStorage();
  });

  afterEach(async () => {
    await database.close();
  });

  it("writes and reads an immutable normalized artifact through the shared contract", async () => {
    const bytes = new TextEncoder().encode("<h1>Hello</h1>");
    const hash = createHash("sha256").update(bytes).digest("hex");
    async function* chunks(): AsyncIterable<ArtifactFileChunk> {
      yield {
        file: {
          path: "index.html",
          sha256: hash,
          size: bytes.byteLength,
          mediaType: "text/html",
        },
        offset: 0,
        bytes,
      };
    }

    const artifacts = new PlatformArtifactStore({
      database,
      storage,
      createId: () => "artifact-normalized-1",
      now: () => new Date("2026-08-09T20:00:00.000Z"),
    });
    const manifest = await artifacts.writeArtifact({ kind: "normalized", files: chunks() });
    expect(manifest).toMatchObject({
      artifactId: "artifact-normalized-1",
      kind: "normalized",
      totalBytes: bytes.byteLength,
      fileCount: 1,
    });
    expect(await artifacts.getManifest(manifest.artifactId)).toMatchObject({
      artifactId: manifest.artifactId,
      files: [{ path: "index.html", sha256: hash }],
    });
    const read: Uint8Array[] = [];
    for await (const chunk of artifacts.readFiles(manifest.artifactId)) {
      read.push(chunk.bytes);
    }
    expect(new TextDecoder().decode(read[0])).toBe("<h1>Hello</h1>");
  });
});
