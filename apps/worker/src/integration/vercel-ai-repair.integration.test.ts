import {
  inspectStaticProject,
  type StaticProjectFile,
} from "@pocketcloud/core/execution";
import { repairStaticProjectWithAi } from "@pocketcloud/normalizer";
import { describe, expect, it } from "vitest";

import { VercelAiRepairClient } from "./vercel-ai-repair";

const runLiveTest = process.env.POCKETCLOUD_RUN_AI_REPAIR_INTEGRATION === "1";
const encoder = new TextEncoder();

describe.skipIf(!runLiveTest)("Vercel AI Gateway repair integration", () => {
  it("repairs one localhost reference and passes deterministic validation", async () => {
    const files: readonly StaticProjectFile[] = [{
      path: "index.html",
      bytes: encoder.encode(
        "<!doctype html><html><body><script src=\"http://localhost:5173/app.js\"></script></body></html>",
      ),
    }, {
      path: "app.js",
      bytes: encoder.encode("document.body.dataset.ready = 'true';"),
    }];
    const result = await repairStaticProjectWithAi(
      files,
      inspectStaticProject(files).findings,
      new VercelAiRepairClient(),
    );

    expect(result.attempted).toBe(true);
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
    expect(result.usage?.outputTokens).toBeGreaterThan(0);
    expect(inspectStaticProject(result.files).findings).toEqual([]);
  }, 30_000);
});
