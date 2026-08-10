import {
  identifierSchema,
  normalizedRelativePathSchema,
  PocketCloudError,
  type Command,
  type CommandResult,
  type ExecutionEnvironment,
  type ExecutionOptions,
  type ExecutionProvider,
  type InputFile,
  type OutputFile,
} from "@pocketcloud/core";
import { Sandbox } from "@vercel/sandbox";

const sandboxWorkspace = "/vercel/sandbox/workspace";
const maximumEnvironmentTimeoutMilliseconds = 120_000;
const maximumVcpus = 4;
const memoryMegabytesPerVcpu = 2_048;
const maximumFilesPerOperation = 500;
const maximumBytesPerFileOperation = 50 * 1024 * 1024;
const defaultMaximumOutputBytes = 1024 * 1024;
const maximumCommandArguments = 256;
const maximumCommandCharacters = 64 * 1024;
const timeoutDetectionToleranceMilliseconds = 100;
const outputTruncationMarker = "\n...[output truncated]";

interface VercelCommandResult {
  exitCode: number;
  durationMs?: number;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
}

interface VercelSandboxClient {
  readonly name: string;
  readonly createdAt: Date;
  mkDir(path: string): Promise<void>;
  writeFiles(files: { path: string; content: Uint8Array }[]): Promise<void>;
  runCommand(parameters: {
    cmd: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    sudo: boolean;
    timeoutMs: number;
  }): Promise<VercelCommandResult>;
  readFileToBuffer(file: { path: string }): Promise<Uint8Array | null>;
  stop(): Promise<unknown>;
}

interface VercelSandboxCreateOptions {
  image: "vercel/sandbox/node:24";
  timeout: number;
  resources: { vcpus: number };
  networkPolicy: "deny-all";
  ports: [];
  env: Record<string, string>;
  tags: { deploymentId: string };
  persistent: false;
}

type CreateVercelSandbox = (
  options: VercelSandboxCreateOptions,
) => Promise<VercelSandboxClient>;

interface VercelSandboxExecutionProviderOptions {
  createSandbox?: CreateVercelSandbox;
  maximumOutputBytes?: number;
  now?: () => number;
}

interface ActiveEnvironment {
  sandbox: VercelSandboxClient;
  timeoutMilliseconds: number;
}

async function createDefaultSandbox(
  options: VercelSandboxCreateOptions,
): Promise<VercelSandboxClient> {
  return Sandbox.create({
    image: options.image,
    timeout: options.timeout,
    resources: options.resources,
    networkPolicy: options.networkPolicy,
    ports: options.ports,
    env: options.env,
    tags: options.tags,
    persistent: options.persistent,
  });
}

function requestInvalid(customerMessage: string): PocketCloudError {
  return new PocketCloudError({
    code: "REQUEST_INVALID",
    customerMessage,
    retryable: false,
  });
}

function notFound(): PocketCloudError {
  return new PocketCloudError({
    code: "NOT_FOUND",
    customerMessage: "That execution environment could not be found.",
    retryable: false,
  });
}

function providerFailed(action: string): PocketCloudError {
  return new PocketCloudError({
    code: "INTERNAL_RETRYABLE",
    customerMessage: `The isolated environment could not ${action}. Please try again.`,
    retryable: true,
  });
}

function validateCreateOptions(options: ExecutionOptions): void {
  if (!identifierSchema.safeParse(options.deploymentId).success) {
    throw requestInvalid("The deployment identifier is invalid.");
  }
  if (
    !Number.isInteger(options.timeoutMilliseconds) ||
    options.timeoutMilliseconds <= 0 ||
    options.timeoutMilliseconds > maximumEnvironmentTimeoutMilliseconds
  ) {
    throw requestInvalid("The execution timeout must be between 1 ms and 120 seconds.");
  }
  if (
    !Number.isInteger(options.vcpus) ||
    options.vcpus < 1 ||
    options.vcpus > maximumVcpus
  ) {
    throw requestInvalid("The execution environment must use between 1 and 4 vCPUs.");
  }
  if (options.memoryMegabytes !== options.vcpus * memoryMegabytesPerVcpu) {
    throw requestInvalid("Execution memory must be 2,048 MB for each requested vCPU.");
  }
  if (options.networkAccess !== "deny" || options.exposePorts !== false) {
    throw requestInvalid("Execution environments must deny network access and exposed ports.");
  }
}

function validatePath(path: string): string {
  if (
    !normalizedRelativePathSchema.safeParse(path).success ||
    [...path].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw requestInvalid("Execution file paths must be normalized relative paths.");
  }
  return `${sandboxWorkspace}/${path}`;
}

function validatePaths(paths: readonly string[]): readonly string[] {
  if (paths.length > maximumFilesPerOperation) {
    throw requestInvalid("An execution file operation cannot contain more than 500 files.");
  }
  const uniquePaths = new Set(paths);
  if (uniquePaths.size !== paths.length) {
    throw requestInvalid("Execution file paths must be unique within an operation.");
  }
  return paths.map(validatePath);
}

function validateFiles(files: readonly InputFile[]): readonly string[] {
  const paths = validatePaths(files.map((file) => file.path));
  let totalBytes = 0;
  for (const file of files) {
    if (!(file.bytes instanceof Uint8Array)) {
      throw requestInvalid("Execution files must contain binary data.");
    }
    totalBytes += file.bytes.byteLength;
    if (totalBytes > maximumBytesPerFileOperation) {
      throw requestInvalid("An execution file operation cannot exceed 50 MB.");
    }
  }
  return paths;
}

function validateCommand(command: Command, environmentTimeoutMilliseconds: number): void {
  if (
    typeof command.executable !== "string" ||
    command.executable.length === 0 ||
    command.executable.includes("\0")
  ) {
    throw requestInvalid("An execution command requires an executable.");
  }
  if (
    !Number.isInteger(command.timeoutMilliseconds) ||
    command.timeoutMilliseconds <= 0 ||
    command.timeoutMilliseconds > environmentTimeoutMilliseconds
  ) {
    throw requestInvalid("The command timeout must fit within the environment timeout.");
  }
  if (
    !Array.isArray(command.arguments) ||
    command.arguments.some(
      (argument) => typeof argument !== "string" || argument.includes("\0"),
    )
  ) {
    throw requestInvalid("Execution command arguments must be valid strings.");
  }
  if (command.arguments.length > maximumCommandArguments) {
    throw requestInvalid("An execution command cannot contain more than 256 arguments.");
  }
  const commandCharacters =
    command.executable.length +
    command.arguments.reduce((total, argument) => total + argument.length, 0);
  if (commandCharacters > maximumCommandCharacters) {
    throw requestInvalid("An execution command cannot exceed 64 KB.");
  }
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maximumBytes) {
    return value;
  }
  const markerBytes = encoder.encode(outputTruncationMarker);
  if (markerBytes.byteLength >= maximumBytes) {
    return decodeUtf8Prefix(bytes, maximumBytes);
  }
  const bodyByteLength = maximumBytes - markerBytes.byteLength;
  const body = decodeUtf8Prefix(bytes, bodyByteLength);
  return `${body}${outputTruncationMarker}`;
}

function decodeUtf8Prefix(bytes: Uint8Array, maximumBytes: number): string {
  const encoder = new TextEncoder();
  let prefixByteLength = Math.min(bytes.byteLength, maximumBytes);
  let prefix = new TextDecoder().decode(bytes.subarray(0, prefixByteLength));
  while (encoder.encode(prefix).byteLength > maximumBytes) {
    prefixByteLength -= 1;
    prefix = new TextDecoder().decode(bytes.subarray(0, prefixByteLength));
  }
  return prefix;
}

function wasTimedOut(
  result: VercelCommandResult,
  elapsedMilliseconds: number,
  timeoutMilliseconds: number,
): boolean {
  const durationMilliseconds = result.durationMs ?? elapsedMilliseconds;
  return (
    (result.exitCode === 137 || result.exitCode === -9) &&
    durationMilliseconds >= timeoutMilliseconds - timeoutDetectionToleranceMilliseconds
  );
}

export class VercelSandboxExecutionProvider implements ExecutionProvider {
  private readonly createSandbox: CreateVercelSandbox;
  private readonly maximumOutputBytes: number;
  private readonly now: () => number;
  private readonly activeEnvironments = new Map<string, ActiveEnvironment>();
  private readonly stoppedEnvironmentIds = new Set<string>();
  private readonly stopTasks = new Map<string, Promise<void>>();

  constructor(options: VercelSandboxExecutionProviderOptions = {}) {
    this.createSandbox = options.createSandbox ?? createDefaultSandbox;
    this.maximumOutputBytes = options.maximumOutputBytes ?? defaultMaximumOutputBytes;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.maximumOutputBytes) || this.maximumOutputBytes <= 0) {
      throw requestInvalid("The command output limit must be a positive integer.");
    }
  }

  async create(options: ExecutionOptions): Promise<ExecutionEnvironment> {
    validateCreateOptions(options);
    let sandbox: VercelSandboxClient;
    try {
      sandbox = await this.createSandbox({
        image: "vercel/sandbox/node:24",
        timeout: options.timeoutMilliseconds,
        resources: { vcpus: options.vcpus },
        networkPolicy: "deny-all",
        ports: [],
        env: {},
        tags: { deploymentId: options.deploymentId },
        persistent: false,
      });
    } catch {
      throw providerFailed("be created");
    }

    try {
      if (!sandbox.name || !(sandbox.createdAt instanceof Date)) {
        throw new Error("Vercel returned incomplete sandbox metadata");
      }
      if (this.activeEnvironments.has(sandbox.name)) {
        throw new Error("Vercel returned a duplicate sandbox name");
      }
      await sandbox.mkDir(sandboxWorkspace);
      this.activeEnvironments.set(sandbox.name, {
        sandbox,
        timeoutMilliseconds: options.timeoutMilliseconds,
      });
      this.stoppedEnvironmentIds.delete(sandbox.name);
      return {
        environmentId: sandbox.name,
        createdAt: sandbox.createdAt.toISOString(),
      };
    } catch {
      await sandbox.stop().catch(() => undefined);
      throw providerFailed("be initialized");
    }
  }

  async writeFiles(environmentId: string, files: readonly InputFile[]): Promise<void> {
    const environment = this.getActiveEnvironment(environmentId);
    const sandboxPaths = validateFiles(files);
    if (files.length === 0) {
      return;
    }
    try {
      await environment.sandbox.writeFiles(
        files.map((file, index) => ({
          path: sandboxPaths[index]!,
          content: Uint8Array.from(file.bytes),
        })),
      );
    } catch {
      throw providerFailed("receive files");
    }
  }

  async run(environmentId: string, command: Command): Promise<CommandResult> {
    const environment = this.getActiveEnvironment(environmentId);
    validateCommand(command, environment.timeoutMilliseconds);
    const startedAt = this.now();
    try {
      const result = await environment.sandbox.runCommand({
        cmd: command.executable,
        args: [...command.arguments],
        cwd: sandboxWorkspace,
        env: {},
        sudo: false,
        timeoutMs: command.timeoutMilliseconds,
      });
      const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
      return {
        exitCode: result.exitCode,
        stdout: truncateUtf8(stdout, this.maximumOutputBytes),
        stderr: truncateUtf8(stderr, this.maximumOutputBytes),
        timedOut: wasTimedOut(result, this.now() - startedAt, command.timeoutMilliseconds),
      };
    } catch {
      throw providerFailed("run the requested command");
    }
  }

  async readFiles(environmentId: string, paths: readonly string[]): Promise<readonly OutputFile[]> {
    const environment = this.getActiveEnvironment(environmentId);
    const sandboxPaths = validatePaths(paths);
    const outputFiles: OutputFile[] = [];
    let totalBytes = 0;
    try {
      for (const [index, path] of paths.entries()) {
        const bytes = await environment.sandbox.readFileToBuffer({ path: sandboxPaths[index]! });
        if (bytes === null) {
          throw new PocketCloudError({
            code: "NOT_FOUND",
            customerMessage: "A requested execution output file could not be found.",
            retryable: false,
          });
        }
        totalBytes += bytes.byteLength;
        if (totalBytes > maximumBytesPerFileOperation) {
          throw requestInvalid("An execution file operation cannot exceed 50 MB.");
        }
        outputFiles.push({ path, bytes: Uint8Array.from(bytes) });
      }
      return outputFiles;
    } catch (error) {
      if (error instanceof PocketCloudError) {
        throw error;
      }
      throw providerFailed("return files");
    }
  }

  async stop(environmentId: string): Promise<void> {
    if (this.stoppedEnvironmentIds.has(environmentId)) {
      return;
    }
    const existingTask = this.stopTasks.get(environmentId);
    if (existingTask) {
      return existingTask;
    }
    const environment = this.activeEnvironments.get(environmentId);
    if (!environment) {
      throw notFound();
    }
    const stopTask = (async () => {
      try {
        await environment.sandbox.stop();
        this.activeEnvironments.delete(environmentId);
        this.stoppedEnvironmentIds.add(environmentId);
      } catch {
        throw providerFailed("be stopped");
      }
    })();
    this.stopTasks.set(environmentId, stopTask);
    try {
      await stopTask;
    } finally {
      this.stopTasks.delete(environmentId);
    }
  }

  private getActiveEnvironment(environmentId: string): ActiveEnvironment {
    const environment = this.activeEnvironments.get(environmentId);
    if (!environment) {
      throw notFound();
    }
    return environment;
  }
}
