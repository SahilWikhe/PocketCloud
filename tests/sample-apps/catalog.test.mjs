import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";

import {
  buildGeneratedArchiveFixtures,
  buildGeneratedDirectoryFixtures,
  materializeGeneratedFixtures,
} from "./archive-fixtures.mjs";
import {
  directoryFixtures,
  fixtureCatalog,
  generatedArchiveFixtures,
  generatedDirectoryFixtures,
} from "./catalog.mjs";

const fixtureRoot = fileURLToPath(new URL(".", import.meta.url));
const generatedRoot = await mkdtemp(path.join(tmpdir(), "pocketcloud-pc200-"));

after(async () => {
  await rm(generatedRoot, { recursive: true, force: true });
});

function inspectCentralDirectory(zipBytes) {
  const endOffset = zipBytes.byteLength - 22;
  assert.equal(zipBytes.readUInt32LE(endOffset), 0x06054b50, "ZIP must end with an EOCD record");
  const entryCount = zipBytes.readUInt16LE(endOffset + 10);
  let offset = zipBytes.readUInt32LE(endOffset + 16);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(zipBytes.readUInt32LE(offset), 0x02014b50, "Expected a central directory entry");
    const nameLength = zipBytes.readUInt16LE(offset + 28);
    const extraLength = zipBytes.readUInt16LE(offset + 30);
    const commentLength = zipBytes.readUInt16LE(offset + 32);
    entries.push({
      name: zipBytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
      compressionMethod: zipBytes.readUInt16LE(offset + 10),
      compressedSize: zipBytes.readUInt32LE(offset + 20),
      expandedSize: zipBytes.readUInt32LE(offset + 24),
      unixMode: zipBytes.readUInt32LE(offset + 38) >>> 16,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

describe("PC-200 sample-app catalog", () => {
  test("documents a unique expected classification and result for every fixture", () => {
    assert.equal(new Set(fixtureCatalog.map((fixture) => fixture.id)).size, fixtureCatalog.length);
    assert.ok(fixtureCatalog.length >= 18);
    for (const fixture of fixtureCatalog) {
      assert.match(fixture.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(["accepted", "repairable", "rejected"].includes(fixture.classification));
      assert.ok(fixture.stage.length > 0);
      assert.ok(fixture.summary.length > 0);
      if (fixture.classification === "accepted") {
        assert.equal(fixture.expectedCode, null);
      } else {
        assert.ok(fixture.expectedCode?.length > 0);
      }
    }
  });

  test("keeps every committed project fixture readable and inside the catalog root", async () => {
    for (const fixture of directoryFixtures) {
      const fixtureDirectory = path.resolve(fixtureRoot, fixture.source);
      assert.equal(path.relative(fixtureRoot, fixtureDirectory).startsWith(".."), false);
      assert.equal((await stat(fixtureDirectory)).isDirectory(), true);
    }
  });

  test("generates binary-content fixtures instead of committing disguised binary text", () => {
    const generated = buildGeneratedDirectoryFixtures();
    assert.deepEqual([...generated.keys()], generatedDirectoryFixtures.map((fixture) => fixture.id));
    const binaryText = generated.get("unexpected-binary-text-content").get("notes.txt");
    assert.equal(binaryText.includes(0x00), true);
    assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(binaryText));
  });

  test("builds every hostile archive without extracting it", () => {
    const archives = buildGeneratedArchiveFixtures();
    assert.deepEqual([...archives.keys()], generatedArchiveFixtures.map((fixture) => fixture.archiveName));

    const traversal = inspectCentralDirectory(archives.get("path-traversal.zip"));
    assert.deepEqual(traversal.map((entry) => entry.name), ["../outside.txt"]);

    const absolute = inspectCentralDirectory(archives.get("absolute-path.zip"));
    assert.deepEqual(absolute.map((entry) => entry.name), ["/tmp/outside.txt"]);

    const symlink = inspectCentralDirectory(archives.get("symlink.zip"));
    assert.equal(symlink.some((entry) => (entry.unixMode & 0o170000) === 0o120000), true);

    const nested = inspectCentralDirectory(archives.get("nested-zip.zip"));
    assert.deepEqual(nested.map((entry) => entry.name), ["site/inner.zip"]);

    const deep = inspectCentralDirectory(archives.get("excessive-directory-depth.zip"));
    assert.equal(deep[0].name.split("/").length - 1, 13);

    const tooMany = inspectCentralDirectory(archives.get("file-count-limit.zip"));
    assert.equal(tooMany.length, 501);

    const tooLargeFile = inspectCentralDirectory(archives.get("single-file-size-limit.zip"));
    assert.equal(tooLargeFile[0].expandedSize, 10 * 1024 * 1024 + 1);

    const tooLargeExpanded = inspectCentralDirectory(archives.get("expanded-size-limit.zip"));
    assert.equal(tooLargeExpanded[0].expandedSize, 50 * 1024 * 1024 + 1);
    assert.ok(tooLargeExpanded[0].compressedSize < tooLargeExpanded[0].expandedSize);
  });

  test("materializes generated fixtures only below a controlled temporary directory", async () => {
    await assert.rejects(
      materializeGeneratedFixtures(path.join(fixtureRoot, "generated")),
      /only be written below the OS temporary directory/,
    );

    const output = await materializeGeneratedFixtures(path.join(generatedRoot, "materialized"));
    for (const fixture of generatedArchiveFixtures) {
      const bytes = await readFile(path.join(output, "archives", fixture.archiveName));
      assert.ok(bytes.byteLength > 0);
    }
    for (const fixture of generatedDirectoryFixtures) {
      assert.equal(
        (await stat(path.join(output, fixture.generatedPath))).isDirectory(),
        true,
      );
    }
  });
});
