import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PocketCloudError } from "../errors/index";
import { describe, expect, it } from "vitest";

import { inspectStaticProject, type StaticProjectFile, validateStaticProject } from "./static-project";

const fixtureRoot = fileURLToPath(new URL("../../../../tests/sample-apps/projects/", import.meta.url));

async function readDirectory(directory: string, prefix = ""): Promise<StaticProjectFile[]> {
  const files: StaticProjectFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await readDirectory(path.join(directory, entry.name), relativePath));
    else if (entry.isFile()) files.push({ path: relativePath, bytes: await readFile(path.join(directory, entry.name)) });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

describe("static project validation", () => {
  it("accepts the valid root fixture", async () => {
    const files = await readDirectory(path.join(fixtureRoot, "valid-root-static"));
    expect(validateStaticProject(files).findings).toEqual([]);
  });

  it("reports every repairable reference fixture", async () => {
    const cases = [
      ["missing-referenced-image", "MISSING_LOCAL_REFERENCE"],
      ["incorrect-filename-capitalization", "REFERENCE_CAPITALIZATION_MISMATCH"],
      ["absolute-local-filesystem-path", "LOCAL_ABSOLUTE_PATH"],
      ["localhost-reference", "LOCALHOST_REFERENCE"],
    ] as const;
    for (const [fixture, code] of cases) {
      const files = await readDirectory(path.join(fixtureRoot, fixture));
      expect(inspectStaticProject(files).findings.some((finding) => finding.code === code)).toBe(true);
    }
  });

  it("rejects executable extensions and disguised binary text", async () => {
    const executable = await readDirectory(path.join(fixtureRoot, "disallowed-executable-extension"));
    expect(() => validateStaticProject(executable)).toThrow(PocketCloudError);
    expect(() => validateStaticProject(executable)).toThrow(expect.objectContaining({ code: "FILE_TYPE_NOT_ALLOWED" }));
    expect(() => validateStaticProject([
      { path: "index.html", bytes: new TextEncoder().encode("<!doctype html>") },
      { path: "notes.txt", bytes: Uint8Array.from([0, 255, 254, 65]) },
    ])).toThrow(expect.objectContaining({ code: "FILE_TYPE_NOT_ALLOWED" }));
  });

  it("rejects credential-like output paths", () => {
    expect(() => validateStaticProject([
      { path: "index.html", bytes: new TextEncoder().encode("<!doctype html>") },
      { path: ".env.production", bytes: new TextEncoder().encode("TOKEN=not-a-real-secret") },
    ])).toThrow(expect.objectContaining({ code: "FILE_TYPE_NOT_ALLOWED" }));
  });

  it("reserves root deployment configuration for the provider adapter", () => {
    expect(() => validateStaticProject([
      { path: "index.html", bytes: new TextEncoder().encode("<!doctype html>") },
      { path: "vercel.json", bytes: new TextEncoder().encode("{\"rewrites\":[]}") },
    ])).toThrow(expect.objectContaining({ code: "FILE_TYPE_NOT_ALLOWED" }));
  });
});
