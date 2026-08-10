import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PocketCloudError,
} from "@pocketcloud/core";
import {
  analyzeStaticProject,
  validateStaticProject,
  type StaticProjectFile,
} from "@pocketcloud/core/execution";
import { describe, expect, it } from "vitest";

import { normalizeStaticProjectDeterministically } from "./normalize-static";

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

async function fixture(name: string): Promise<StaticProjectFile[]> {
  return readDirectory(path.join(fixtureRoot, name));
}

function snapshots(files: readonly StaticProjectFile[]): readonly [string, string][] {
  return files.map((file) => [file.path, Buffer.from(file.bytes).toString("hex")]);
}

describe("deterministic static normalization", () => {
  it("moves one wrapper into a canonical output without modifying input", async () => {
    const files = await fixture("valid-wrapper-static");
    const before = snapshots(files);
    const result = normalizeStaticProjectDeterministically({ files, plan: analyzeStaticProject(files) });
    expect(result.files.map((file) => file.path)).toEqual(["index.html", "styles.css"]);
    expect(result.changes).toHaveLength(2);
    expect(result.changes.every((change) => change.ruleCode === "MOVE_WRAPPER" && change.operation === "move")).toBe(true);
    expect(result.findings).toEqual([]);
    expect(snapshots(files)).toEqual(before);
    expect(validateStaticProject(result.files).findings).toEqual([]);
  });

  it("fixes a unique filename-capitalization reference", async () => {
    const files = await fixture("incorrect-filename-capitalization");
    const result = normalizeStaticProjectDeterministically({ files, plan: analyzeStaticProject(files) });
    const html = new TextDecoder().decode(result.files.find((file) => file.path === "index.html")!.bytes);
    expect(html).toContain("assets/cloud.svg");
    expect(html).not.toContain("assets/Cloud.svg");
    expect(result.changes).toContainEqual(expect.objectContaining({
      source: "deterministic",
      ruleCode: "FIX_REFERENCE_CAPITALIZATION",
      operation: "modify",
      path: "index.html",
    }));
    expect(result.findings).toEqual([]);
  });

  it.each([
    ["missing-referenced-image", "MISSING_LOCAL_REFERENCE"],
    ["absolute-local-filesystem-path", "LOCAL_ABSOLUTE_PATH"],
    ["localhost-reference", "LOCALHOST_REFERENCE"],
  ])("reports unresolved repairable findings for %s", async (fixtureName, code) => {
    const files = await fixture(fixtureName);
    const result = normalizeStaticProjectDeterministically({ files, plan: analyzeStaticProject(files) });
    expect(result.findings).toContainEqual(expect.objectContaining({ code, repairable: true }));
  });

  it("removes only known metadata and records the deletion", () => {
    const files = [
      { path: ".DS_Store", bytes: new TextEncoder().encode("metadata") },
      { path: "index.html", bytes: new TextEncoder().encode("<!doctype html>") },
    ];
    const result = normalizeStaticProjectDeterministically({ files, plan: analyzeStaticProject(files) });
    expect(result.files.map((file) => file.path)).toEqual(["index.html"]);
    expect(result.changes).toContainEqual(expect.objectContaining({
      ruleCode: "REMOVE_IRRELEVANT_METADATA",
      operation: "delete",
      path: ".DS_Store",
    }));
  });

  it("rejects disallowed output and unknown wrapper siblings", async () => {
    const disallowed = await fixture("disallowed-executable-extension");
    expect(() => normalizeStaticProjectDeterministically({ files: disallowed, plan: analyzeStaticProject(disallowed) }))
      .toThrow(expect.objectContaining({ code: "FILE_TYPE_NOT_ALLOWED" }));
    const wrapped = await fixture("valid-wrapper-static");
    const withSibling = [...wrapped, { path: "README.txt", bytes: new TextEncoder().encode("unknown") }];
    expect(() => normalizeStaticProjectDeterministically({ files: withSibling, plan: analyzeStaticProject(withSibling) }))
      .toThrow(expect.objectContaining({ code: "NORMALIZATION_FAILED" }));
  });

  it("produces identical bytes when normalized output is normalized again", async () => {
    const files = await fixture("valid-wrapper-static");
    const first = normalizeStaticProjectDeterministically({ files, plan: analyzeStaticProject(files) });
    const second = normalizeStaticProjectDeterministically({ files: first.files, plan: analyzeStaticProject(first.files) });
    expect(snapshots(second.files)).toEqual(snapshots(first.files));
    expect(second.findings).toEqual([]);
  });

  it("uses customer-safe stable errors", () => {
    expect(() => normalizeStaticProjectDeterministically({
      files: [{ path: "index.html", bytes: new TextEncoder().encode("<!doctype html>") }],
      plan: { ...analyzeStaticProject([{ path: "index.html", bytes: new TextEncoder().encode("<!doctype html>") }]), kind: "service" },
    })).toThrow(PocketCloudError);
  });
});
