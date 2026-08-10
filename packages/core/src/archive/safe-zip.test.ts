import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PocketCloudError } from "../errors/index";
import { archivePolicy } from "../policies/archive";
import { extractZipArchive, inspectAndExtractZip } from "./safe-zip";

// @ts-expect-error PC-200 intentionally keeps its dependency-free ZIP fixture builder in ESM JavaScript.
import { buildGeneratedArchiveFixtures, createZip } from "../../../../tests/sample-apps/archive-fixtures.mjs";

let temporaryRoot: string;
let hostileArchives: Map<string, Uint8Array>;

beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "pocketcloud-pc202-"));
  hostileArchives = buildGeneratedArchiveFixtures() as Map<string, Uint8Array>;
});

afterAll(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

function expectCode(error: unknown, code: string): boolean {
  expect(error).toBeInstanceOf(PocketCloudError);
  expect(error).toMatchObject({ code, retryable: false });
  return true;
}

describe("safe ZIP inspection and extraction", () => {
  it.each([
    ["path-traversal.zip", "ARCHIVE_UNSAFE_PATH"],
    ["absolute-path.zip", "ARCHIVE_UNSAFE_PATH"],
    ["symlink.zip", "ARCHIVE_UNSAFE_PATH"],
    ["nested-zip.zip", "FILE_TYPE_NOT_ALLOWED"],
    ["file-count-limit.zip", "ARCHIVE_LIMIT_EXCEEDED"],
    ["single-file-size-limit.zip", "ARCHIVE_LIMIT_EXCEEDED"],
    ["expanded-size-limit.zip", "ARCHIVE_LIMIT_EXCEEDED"],
    ["excessive-directory-depth.zip", "ARCHIVE_LIMIT_EXCEEDED"],
  ])("rejects the hostile PC-200 fixture %s", async (archiveName, code) => {
    const output = path.join(temporaryRoot, archiveName.replace(/\.zip$/, ""));
    await expect(extractZipArchive(hostileArchives.get(archiveName)!, output))
      .rejects.toSatisfy((error: unknown) => expectCode(error, code));
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("extracts a valid ZIP atomically beneath the assigned directory", async () => {
    const archive = createZip([
      { name: "site/index.html", bytes: "<!doctype html><title>Fixture</title>" },
      { name: "site/assets/app.js", bytes: "document.body.dataset.ready = 'true';" },
    ]) as Uint8Array;
    const output = path.join(temporaryRoot, "valid-output");
    await expect(extractZipArchive(archive, output)).resolves.toEqual([
      "site/assets/app.js",
      "site/index.html",
    ]);
    await expect(readFile(path.join(output, "site/index.html"), "utf8"))
      .resolves.toContain("Fixture");
  });

  it("enforces compressed-size and processing-time budgets", async () => {
    await expect(inspectAndExtractZip(new Uint8Array(archivePolicy.maximumCompressedBytes + 1)))
      .rejects.toSatisfy((error: unknown) => expectCode(error, "ARCHIVE_LIMIT_EXCEEDED"));
    const archive = createZip([{ name: "index.html", bytes: "<!doctype html>" }]) as Uint8Array;
    let clock = 0;
    await expect(inspectAndExtractZip(archive, { now: () => {
      clock += archivePolicy.maximumProcessingMilliseconds + 1;
      return clock;
    } })).rejects.toSatisfy((error: unknown) => expectCode(error, "ARCHIVE_LIMIT_EXCEEDED"));
  });

  it("rejects control characters, drive paths, aliases, and non-file Unix entries", async () => {
    const cases = [
      createZip([{ name: "site/bad\u0000name.txt", bytes: "x" }]),
      createZip([{ name: "C:/outside.txt", bytes: "x" }]),
      createZip([{ name: "site/App.js", bytes: "a" }, { name: "site/app.js", bytes: "b" }]),
      createZip([{ name: "site/device", bytes: "x", unixMode: 0o020666 }]),
    ] as Uint8Array[];
    for (const archive of cases) {
      await expect(inspectAndExtractZip(archive))
        .rejects.toSatisfy((error: unknown) => expectCode(error, "ARCHIVE_UNSAFE_PATH"));
    }
  });

  it("does not overwrite an assigned output directory", async () => {
    const archive = createZip([{ name: "index.html", bytes: "<!doctype html>" }]) as Uint8Array;
    const output = path.join(temporaryRoot, "valid-output");
    await expect(extractZipArchive(archive, output))
      .rejects.toSatisfy((error: unknown) => expectCode(error, "CONFLICT"));
  });
});
