import {
  inspectStaticProject,
  type StaticProjectFile,
} from "@pocketcloud/core/execution";
import { describe, expect, it, vi } from "vitest";

import { repairStaticProjectWithAi, type AiRepairClient } from "./structured-repair";

const encoder = new TextEncoder();

function project(html: string, extra: readonly StaticProjectFile[] = []): StaticProjectFile[] {
  return [{ path: "index.html", bytes: encoder.encode(html) }, ...extra];
}

function response(patches: readonly unknown[], usage = { inputTokens: 100, outputTokens: 50 }): unknown {
  return { schemaVersion: 1, patches, usage };
}

describe("structured AI repair", () => {
  it("does not call AI when deterministic validation has no findings", async () => {
    const files = project("<!doctype html><title>Valid</title>");
    const client = { proposePatch: vi.fn() } as AiRepairClient;
    await expect(repairStaticProjectWithAi(files, [], client)).resolves.toMatchObject({ attempted: false, usage: null, changes: [] });
    expect(client.proposePatch).not.toHaveBeenCalled();
  });

  it("allows one bounded repair attempt and reports usage and accepted changes", async () => {
    const files = project("<!doctype html><script src=\"http://localhost:5173/app.js\"></script>");
    const findings = inspectStaticProject(files).findings;
    const client: AiRepairClient = {
      proposePatch: vi.fn(async () => response([{
        operation: "replace",
        path: "index.html",
        content: "<!doctype html><script src=\"app.js\"></script>",
      }, {
        operation: "create",
        path: "app.js",
        content: "document.body.dataset.ready = 'true';",
      }])),
    };
    const result = await repairStaticProjectWithAi(files, findings, client);
    expect(client.proposePatch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ attempted: true, usage: { inputTokens: 100, outputTokens: 50 } });
    expect(result.changes).toHaveLength(2);
    expect(result.changes.every((change) => change.source === "ai" && change.requiresCustomerAttention)).toBe(true);
    expect(inspectStaticProject(result.files).findings).toEqual([]);
  });

  it("excludes secret-bearing and binary files from the AI request", async () => {
    const files = project(
      "<!doctype html><script src=\"http://localhost:5173/app.js\"></script>",
      [
        { path: "credentials.txt", bytes: encoder.encode("not-a-real-secret") },
        { path: "image.png", bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]) },
      ],
    );
    const client: AiRepairClient = {
      proposePatch: vi.fn(async () => {
        throw new Error("stop after request inspection");
      }),
    };
    await expect(repairStaticProjectWithAi(
      files,
      inspectStaticProject(files).findings.filter((finding) => finding.repairable),
      client,
    )).rejects.toMatchObject({ code: "INTERNAL_RETRYABLE" });
    const request = vi.mocked(client.proposePatch).mock.calls[0]![0];
    expect(request.files.map((file) => file.path)).toEqual(["index.html"]);
    expect(JSON.stringify(request)).not.toContain("not-a-real-secret");
  });

  it.each([
    response([{ operation: "replace", path: "../escape.html", content: "x" }]),
    response([{ operation: "command", path: "index.html", command: "rm -rf" }]),
    response([{ operation: "create", path: ".env", content: "TOKEN=x" }]),
    response([{ operation: "create", path: "image.png", content: "not binary" }]),
    response(Array.from({ length: 6 }, (_, index) => ({ operation: "create", path: `file-${index}.txt`, content: "x" }))),
  ])("rejects an unsafe or excessive patch response", async (unsafeResponse) => {
    const files = project("<!doctype html><script src=\"http://localhost:5173/app.js\"></script>");
    const client: AiRepairClient = { proposePatch: async () => unsafeResponse };
    await expect(repairStaticProjectWithAi(files, inspectStaticProject(files).findings, client))
      .rejects.toMatchObject({ code: "AI_PATCH_REJECTED", retryable: false });
  });

  it("runs deterministic validation after patch application", async () => {
    const files = project("<!doctype html><img src=\"missing.png\">");
    const client: AiRepairClient = {
      proposePatch: async () => response([{ operation: "replace", path: "index.html", content: "<!doctype html><img src=\"still-missing.png\">" }]),
    };
    await expect(repairStaticProjectWithAi(files, inspectStaticProject(files).findings, client))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED", retryable: false });
  });

  it("enforces reported token budgets", async () => {
    const files = project("<!doctype html><script src=\"http://localhost:5173/app.js\"></script>");
    const client: AiRepairClient = {
      proposePatch: async () => response([], { inputTokens: 100, outputTokens: 2_001 }),
    };
    await expect(repairStaticProjectWithAi(files, inspectStaticProject(files).findings, client))
      .rejects.toMatchObject({ code: "AI_BUDGET_EXCEEDED", retryable: false });
  });
});
