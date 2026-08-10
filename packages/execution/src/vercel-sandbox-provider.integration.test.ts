import { describe, expect, it } from "vitest";

import { VercelSandboxExecutionProvider } from "./vercel-sandbox-provider";

const runLiveIntegration =
  process.env.POCKETCLOUD_RUN_VERCEL_SANDBOX_INTEGRATION === "1";

describe.skipIf(!runLiveIntegration)("VercelSandboxExecutionProvider live integration", () => {
  it("writes, executes, reads, denies egress, times out, and stops a real sandbox", async () => {
    const provider = new VercelSandboxExecutionProvider();
    const environment = await provider.create({
      deploymentId: `pc-201-integration-${Date.now()}`,
      timeoutMilliseconds: 60_000,
      memoryMegabytes: 2_048,
      vcpus: 1,
      networkAccess: "deny",
      exposePorts: false,
    });

    try {
      await provider.writeFiles(environment.environmentId, [
        {
          path: "input.txt",
          bytes: new TextEncoder().encode("PocketCloud"),
        },
      ]);
      const processResult = await provider.run(environment.environmentId, {
        executable: "node",
        arguments: [
          "-e",
          "const fs=require('node:fs');fs.writeFileSync('output.txt',fs.readFileSync('input.txt','utf8').toUpperCase())",
        ],
        timeoutMilliseconds: 10_000,
      });
      expect(processResult).toMatchObject({ exitCode: 0, timedOut: false });
      const [output] = await provider.readFiles(environment.environmentId, ["output.txt"]);
      expect(new TextDecoder().decode(output?.bytes)).toBe("POCKETCLOUD");

      const networkResult = await provider.run(environment.environmentId, {
        executable: "node",
        arguments: [
          "-e",
          "fetch('https://example.com').then(()=>process.exit(1)).catch(()=>console.log('denied'))",
        ],
        timeoutMilliseconds: 10_000,
      });
      expect(networkResult).toMatchObject({ exitCode: 0, timedOut: false });
      expect(networkResult.stdout).toContain("denied");

      const timeoutResult = await provider.run(environment.environmentId, {
        executable: "node",
        arguments: ["-e", "setTimeout(()=>{},10_000)"],
        timeoutMilliseconds: 1_000,
      });
      expect(timeoutResult.timedOut).toBe(true);
    } finally {
      await provider.stop(environment.environmentId);
      await provider.stop(environment.environmentId);
    }
  }, 90_000);
});
