import { PocketCloudError } from "@pocketcloud/core";
import { describe, expect, it, vi } from "vitest";

import { VercelSandboxExecutionProvider } from "./vercel-sandbox-provider";

const createdAt = new Date("2026-08-09T20:00:00.000Z");
const executionOptions = {
  deploymentId: "deployment-201",
  timeoutMilliseconds: 60_000,
  memoryMegabytes: 2_048,
  vcpus: 1,
  networkAccess: "deny" as const,
  exposePorts: false as const,
};

function createFakeSandbox() {
  const commandResult = {
    exitCode: 0,
    durationMs: 12,
    stdout: vi.fn(async () => "processed\n"),
    stderr: vi.fn(async () => ""),
  };
  return {
    name: "sandbox-pc-201",
    createdAt,
    mkDir: vi.fn<(path: unknown) => Promise<void>>(async () => undefined),
    writeFiles: vi.fn<(files: unknown) => Promise<void>>(async () => undefined),
    runCommand: vi.fn<(parameters: unknown) => Promise<typeof commandResult>>(async () =>
      commandResult,
    ),
    readFileToBuffer: vi.fn<
      (file: { path: string }) => Promise<Uint8Array | null>
    >(async () => new TextEncoder().encode("artifact")),
    stop: vi.fn<() => Promise<void>>(async () => undefined),
    commandResult,
  };
}

function expectPocketCloudError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(PocketCloudError);
  expect(error).toMatchObject({ code });
}

describe("VercelSandboxExecutionProvider", () => {
  it("creates a bounded non-persistent sandbox with no network, ports, or environment", async () => {
    const sandbox = createFakeSandbox();
    const createSandbox = vi.fn<(options: unknown) => Promise<typeof sandbox>>(async () => sandbox);
    const provider = new VercelSandboxExecutionProvider({ createSandbox });

    await expect(provider.create(executionOptions)).resolves.toEqual({
      environmentId: "sandbox-pc-201",
      createdAt: createdAt.toISOString(),
    });
    expect(createSandbox).toHaveBeenCalledWith({
      image: "vercel/sandbox/node:24",
      timeout: 60_000,
      resources: { vcpus: 1 },
      networkPolicy: "deny-all",
      ports: [],
      env: {},
      tags: { deploymentId: "deployment-201" },
      persistent: false,
    });
    expect(sandbox.mkDir).toHaveBeenCalledWith("workspace");
  });

  it("rejects runtime settings that would weaken or misrepresent the sandbox", async () => {
    const sandbox = createFakeSandbox();
    const createSandbox = vi.fn<(options: unknown) => Promise<typeof sandbox>>(async () => sandbox);
    const provider = new VercelSandboxExecutionProvider({ createSandbox });

    await expect(
      provider.create({ ...executionOptions, memoryMegabytes: 1_024 }),
    ).rejects.toSatisfy((error: unknown) => {
      expectPocketCloudError(error, "REQUEST_INVALID");
      return true;
    });
    await expect(
      provider.create({ ...executionOptions, timeoutMilliseconds: 120_001 }),
    ).rejects.toSatisfy((error: unknown) => {
      expectPocketCloudError(error, "REQUEST_INVALID");
      return true;
    });
    expect(createSandbox).not.toHaveBeenCalled();
  });

  it("writes, runs, and reads only inside the fixed sandbox workspace", async () => {
    const sandbox = createFakeSandbox();
    const provider = new VercelSandboxExecutionProvider({
      createSandbox: async () => sandbox,
    });
    await provider.create(executionOptions);
    const input = new TextEncoder().encode("input");

    await provider.writeFiles("sandbox-pc-201", [{ path: "src/index.js", bytes: input }]);
    await expect(
      provider.run("sandbox-pc-201", {
        executable: "node",
        arguments: ["src/index.js"],
        timeoutMilliseconds: 5_000,
      }),
    ).resolves.toEqual({
      exitCode: 0,
      stdout: "processed\n",
      stderr: "",
      timedOut: false,
    });
    await expect(provider.readFiles("sandbox-pc-201", ["dist/index.html"])).resolves.toEqual([
      { path: "dist/index.html", bytes: new TextEncoder().encode("artifact") },
    ]);

    expect(sandbox.writeFiles).toHaveBeenCalledWith([
      {
        path: "/vercel/workspace/src/index.js",
        content: input,
      },
    ]);
    expect(sandbox.runCommand).toHaveBeenCalledWith({
      cmd: "node",
      args: ["src/index.js"],
      cwd: "/vercel/workspace",
      env: {},
      sudo: false,
      timeoutMs: 5_000,
    });
    expect(sandbox.readFileToBuffer).toHaveBeenCalledWith({
      path: "/vercel/workspace/dist/index.html",
    });
  });

  it("bounds UTF-8 command output and reports sandbox-enforced timeouts", async () => {
    const sandbox = createFakeSandbox();
    sandbox.commandResult.exitCode = 137;
    sandbox.commandResult.durationMs = 950;
    sandbox.commandResult.stdout.mockResolvedValue("😀".repeat(50));
    sandbox.commandResult.stderr.mockResolvedValue("error".repeat(20));
    const provider = new VercelSandboxExecutionProvider({
      createSandbox: async () => sandbox,
      maximumOutputBytes: 48,
    });
    await provider.create({ ...executionOptions, timeoutMilliseconds: 1_000 });

    const result = await provider.run("sandbox-pc-201", {
      executable: "node",
      arguments: ["slow.js"],
      timeoutMilliseconds: 1_000,
    });

    expect(result.timedOut).toBe(true);
    expect(new TextEncoder().encode(result.stdout).byteLength).toBeLessThanOrEqual(48);
    expect(new TextEncoder().encode(result.stderr).byteLength).toBeLessThanOrEqual(48);
    expect(result.stdout).toContain("...[output truncated]");
    expect(result.stderr).toContain("...[output truncated]");
  });

  it("rejects path traversal and reports missing outputs without leaking provider errors", async () => {
    const sandbox = createFakeSandbox();
    sandbox.readFileToBuffer.mockResolvedValue(null);
    const provider = new VercelSandboxExecutionProvider({
      createSandbox: async () => sandbox,
    });
    await provider.create(executionOptions);

    await expect(
      provider.writeFiles("sandbox-pc-201", [
        { path: "../escape.txt", bytes: new Uint8Array() },
      ]),
    ).rejects.toSatisfy((error: unknown) => {
      expectPocketCloudError(error, "REQUEST_INVALID");
      return true;
    });
    await expect(
      provider.readFiles("sandbox-pc-201", ["missing.txt"]),
    ).rejects.toSatisfy((error: unknown) => {
      expectPocketCloudError(error, "NOT_FOUND");
      return true;
    });
    expect(sandbox.writeFiles).not.toHaveBeenCalled();
  });

  it("makes concurrent and repeated stops idempotent", async () => {
    const sandbox = createFakeSandbox();
    let releaseStop: (() => void) | undefined;
    sandbox.stop.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        releaseStop = resolve;
      }),
    );
    const provider = new VercelSandboxExecutionProvider({
      createSandbox: async () => sandbox,
    });
    await provider.create(executionOptions);

    const firstStop = provider.stop("sandbox-pc-201");
    const secondStop = provider.stop("sandbox-pc-201");
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
    releaseStop?.();
    await Promise.all([firstStop, secondStop]);
    await provider.stop("sandbox-pc-201");
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps a sandbox active when stopping fails so cleanup can be retried", async () => {
    const sandbox = createFakeSandbox();
    sandbox.stop.mockRejectedValueOnce(new Error("temporary stop failure"));
    const provider = new VercelSandboxExecutionProvider({
      createSandbox: async () => sandbox,
    });
    await provider.create(executionOptions);

    await expect(provider.stop("sandbox-pc-201")).rejects.toSatisfy((error: unknown) => {
      expectPocketCloudError(error, "INTERNAL_RETRYABLE");
      return true;
    });
    await expect(provider.stop("sandbox-pc-201")).resolves.toBeUndefined();
    expect(sandbox.stop).toHaveBeenCalledTimes(2);
  });

  it("converts SDK failures into customer-safe retryable errors", async () => {
    const provider = new VercelSandboxExecutionProvider({
      createSandbox: async () => {
        throw new Error("VERCEL_TOKEN=secret-value");
      },
    });

    await expect(provider.create(executionOptions)).rejects.toSatisfy((error: unknown) => {
      expectPocketCloudError(error, "INTERNAL_RETRYABLE");
      expect((error as Error).message).not.toContain("secret-value");
      expect(error).not.toHaveProperty("cause");
      return true;
    });
  });
});
