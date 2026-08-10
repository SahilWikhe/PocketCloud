import {
  projectPlanV1Schema,
  type ProjectEvidence,
  type ProjectPlanV1,
} from "../contracts/project-plan";
import { normalizedRelativePathSchema } from "../contracts/common";
import { PocketCloudError } from "../errors/index";
import {
  collectStaticReferences,
  isAllowedStaticPath,
  type StaticProjectFile,
} from "../validators/static-project";

function rejected(code: "ENTRYPOINT_MISSING" | "PROJECT_UNSUPPORTED", message: string): PocketCloudError {
  return new PocketCloudError({ code, customerMessage: message, retryable: false });
}

function validateInventory(files: readonly StaticProjectFile[]): void {
  const paths = new Set<string>();
  for (const file of files) {
    if (
      !normalizedRelativePathSchema.safeParse(file.path).success ||
      !(file.bytes instanceof Uint8Array) ||
      paths.has(file.path)
    ) {
      throw rejected("PROJECT_UNSUPPORTED", "The project file inventory is invalid or ambiguous.");
    }
    paths.add(file.path);
  }
}

function findCandidateRoots(files: readonly StaticProjectFile[]): readonly string[] {
  const roots = new Set<string>();
  for (const file of files) {
    const segments = file.path.split("/");
    if (segments.length === 1 && file.path === "index.html") roots.add(".");
    if (segments.length === 2 && segments[1] === "index.html") roots.add(segments[0]!);
  }
  return [...roots].sort((left, right) => left.localeCompare(right));
}

export function analyzeStaticProject(files: readonly StaticProjectFile[]): ProjectPlanV1 {
  validateInventory(files);
  const candidateRoots = findCandidateRoots(files);
  if (candidateRoots.length === 0) {
    throw rejected("ENTRYPOINT_MISSING", "The project does not contain a supported index.html entry point.");
  }
  if (candidateRoots.length > 1) {
    throw rejected(
      "PROJECT_UNSUPPORTED",
      "The upload contains multiple possible static sites, so PocketCloud cannot choose one safely.",
    );
  }
  const projectRoot = candidateRoots[0]!;
  const prefix = projectRoot === "." ? "" : `${projectRoot}/`;
  const projectFiles = files.filter((file) => prefix === "" || file.path.startsWith(prefix));
  const evidence: ProjectEvidence[] = [
    {
      code: "STATIC_ENTRYPOINT",
      path: prefix === "" ? "index.html" : `${prefix}index.html`,
      summary: "Found a static index.html entry point.",
    },
    ...projectFiles.map((file) => ({
      code: isAllowedStaticPath(file.path) ? "FILE_INVENTORY" : "UNSUPPORTED_FILE",
      path: file.path,
      summary: isAllowedStaticPath(file.path)
        ? "Included this file in the static project inventory."
        : "This file requires rejection during static validation.",
    })),
    ...collectStaticReferences(projectFiles).map(({ path }) => ({
      code: "LOCAL_REFERENCE",
      path,
      summary: "Found a local resource reference for deterministic validation.",
    })),
  ];

  return projectPlanV1Schema.parse({
    schemaVersion: 1,
    kind: "static",
    projectRoot,
    entrypoint: projectRoot === "." ? "index.html" : `${projectRoot}/index.html`,
    runtime: null,
    framework: null,
    installCommand: null,
    buildCommand: null,
    startCommand: null,
    outputDirectory: ".",
    requiredEnvironmentVariables: [],
    deploymentProvider: "vercel",
    evidence,
  });
}
