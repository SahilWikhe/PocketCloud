import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PocketCloudError } from "../errors/index";
import type { StaticProjectFile } from "../validators/static-project";
import { analyzeStaticProject } from "./static-project";

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

function hasCode(error: unknown, code: string): boolean {
  expect(error).toBeInstanceOf(PocketCloudError);
  expect(error).toMatchObject({ code, retryable: false });
  return true;
}

describe("analyzeStaticProject", () => {
  it("identifies a root-level static site and reports inventory and references", async () => {
    const plan = analyzeStaticProject(await fixture("valid-root-static"));
    expect(plan).toMatchObject({
      schemaVersion: 1,
      kind: "static",
      projectRoot: ".",
      entrypoint: "index.html",
      outputDirectory: ".",
      deploymentProvider: "vercel",
    });
    expect(plan.evidence.some((item) => item.code === "FILE_INVENTORY" && item.path === "app.js")).toBe(true);
    expect(plan.evidence.some((item) => item.code === "LOCAL_REFERENCE" && item.path === "index.html")).toBe(true);
  });

  it("identifies one wrapper directory without modifying it", async () => {
    const files = await fixture("valid-wrapper-static");
    const before = files.map((file) => [file.path, Buffer.from(file.bytes).toString("hex")]);
    const plan = analyzeStaticProject(files);
    expect(plan).toMatchObject({ projectRoot: "website", entrypoint: "website/index.html" });
    expect(files.map((file) => [file.path, Buffer.from(file.bytes).toString("hex")])).toEqual(before);
  });

  it("rejects missing and ambiguous entry points instead of guessing", async () => {
    await expect(Promise.resolve().then(async () => analyzeStaticProject(await fixture("missing-index"))))
      .rejects.toSatisfy((error: unknown) => hasCode(error, "ENTRYPOINT_MISSING"));
    await expect(Promise.resolve().then(async () => analyzeStaticProject(await fixture("ambiguous-multiple-sites"))))
      .rejects.toSatisfy((error: unknown) => hasCode(error, "PROJECT_UNSUPPORTED"));
  });

  it("reports unsupported files for the validation stage", async () => {
    const plan = analyzeStaticProject(await fixture("disallowed-executable-extension"));
    expect(plan.evidence).toContainEqual({
      code: "UNSUPPORTED_FILE",
      path: "scripts/start.sh",
      summary: "This file requires rejection during static validation.",
    });
  });
});
