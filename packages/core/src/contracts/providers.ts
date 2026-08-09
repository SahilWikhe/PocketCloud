import type { ArtifactFile, ArtifactManifestV1 } from "./artifact";

export interface InputFile {
  path: string;
  bytes: Uint8Array;
}

export interface OutputFile extends InputFile {}

export interface Command {
  executable: string;
  arguments: readonly string[];
  timeoutMilliseconds: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecutionOptions {
  deploymentId: string;
  timeoutMilliseconds: number;
  memoryMegabytes: number;
  vcpus: number;
  networkAccess: "deny";
  exposePorts: false;
}

export interface ExecutionEnvironment {
  environmentId: string;
  createdAt: string;
}

export interface ExecutionProvider {
  create(options: ExecutionOptions): Promise<ExecutionEnvironment>;
  writeFiles(environmentId: string, files: readonly InputFile[]): Promise<void>;
  run(environmentId: string, command: Command): Promise<CommandResult>;
  readFiles(environmentId: string, paths: readonly string[]): Promise<readonly OutputFile[]>;
  stop(environmentId: string): Promise<void>;
}

export interface ArtifactFileChunk {
  file: ArtifactFile;
  offset: number;
  bytes: Uint8Array;
}

export interface NewArtifactInput {
  kind: ArtifactManifestV1["kind"];
  files: AsyncIterable<ArtifactFileChunk>;
}

export interface ArtifactStore {
  getManifest(artifactId: string): Promise<ArtifactManifestV1>;
  readFiles(artifactId: string): AsyncIterable<ArtifactFileChunk>;
  writeArtifact(input: NewArtifactInput): Promise<ArtifactManifestV1>;
}

export interface ArtifactFileSource {
  read(file: ArtifactFile): AsyncIterable<Uint8Array>;
}

export interface DeployableArtifact {
  manifest: ArtifactManifestV1;
  files: ArtifactFileSource;
  idempotencyKey: string;
}

export interface ProviderDeployment {
  provider: string;
  providerDeploymentId: string;
  providerProjectId?: string;
  candidateUrl?: string;
}

export type ProviderDeploymentStatus =
  | "PENDING"
  | "BUILDING"
  | "READY"
  | "FAILED"
  | "CANCELLED";

export interface ProviderLog {
  occurredAt: string;
  level: "info" | "warning" | "error";
  message: string;
}

export interface DeploymentProvider {
  deploy(input: DeployableArtifact): Promise<ProviderDeployment>;
  getStatus(providerDeploymentId: string): Promise<ProviderDeploymentStatus>;
  getLogs(providerDeploymentId: string): Promise<readonly ProviderLog[]>;
  cancel(providerDeploymentId: string): Promise<void>;
  remove(providerDeploymentId: string): Promise<void>;
}
