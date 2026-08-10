import path from "node:path";

import {
  assertStaticMvpPlan,
  PocketCloudError,
  type NormalizationChangeV1,
  type ProjectPlanV1,
} from "@pocketcloud/core";
import {
  decodeStaticText,
  inspectStaticProject,
  isKnownIrrelevantMetadata,
  type StaticProjectFile,
  type StaticProjectFinding,
} from "@pocketcloud/core/execution";

import { createNormalizationChange, sha256 } from "../change-log/change";

export interface DeterministicNormalizationInput {
  files: readonly StaticProjectFile[];
  plan: ProjectPlanV1;
}

export interface DeterministicNormalizationResult {
  files: readonly StaticProjectFile[];
  changes: readonly NormalizationChangeV1[];
  findings: readonly StaticProjectFinding[];
}

function cloneFile(file: StaticProjectFile, outputPath = file.path): StaticProjectFile {
  return { path: outputPath, bytes: Uint8Array.from(file.bytes) };
}

function failForNonRepairableFinding(finding: StaticProjectFinding): never {
  const code = finding.code === "FILE_TYPE_NOT_ALLOWED"
    ? "FILE_TYPE_NOT_ALLOWED"
    : finding.code === "ENTRYPOINT_MISSING"
      ? "ENTRYPOINT_MISSING"
      : "VALIDATION_FAILED";
  throw new PocketCloudError({
    code,
    customerMessage: finding.summary,
    retryable: false,
  });
}

function replacementReference(sourcePath: string, actualPath: string, original: string): string {
  const suffixIndex = original.search(/[?#]/);
  const suffix = suffixIndex === -1 ? "" : original.slice(suffixIndex);
  const relative = path.posix.relative(path.posix.dirname(sourcePath), actualPath);
  return `${relative || path.posix.basename(actualPath)}${suffix}`;
}

function fixReferenceCapitalization(
  files: readonly StaticProjectFile[],
  changes: NormalizationChangeV1[],
): readonly StaticProjectFile[] {
  const findings = inspectStaticProject(files).findings.filter(
    (finding) => finding.code === "REFERENCE_CAPITALIZATION_MISMATCH",
  );
  const bySource = new Map<string, StaticProjectFinding[]>();
  for (const finding of findings) {
    if (finding.path) bySource.set(finding.path, [...(bySource.get(finding.path) ?? []), finding]);
  }
  return files.map((file) => {
    const fileFindings = bySource.get(file.path);
    if (!fileFindings) return file;
    const originalText = decodeStaticText(file);
    if (originalText === null) return file;
    let updatedText = originalText;
    for (const finding of fileFindings) {
      if (!finding.reference || !finding.resolvedPath) continue;
      const replacement = replacementReference(file.path, finding.resolvedPath, finding.reference);
      updatedText = updatedText.split(finding.reference).join(replacement);
    }
    if (updatedText === originalText) return file;
    const updatedBytes = new TextEncoder().encode(updatedText);
    changes.push(createNormalizationChange({
      source: "deterministic",
      ruleCode: "FIX_REFERENCE_CAPITALIZATION",
      operation: "modify",
      path: file.path,
      beforeSha256: sha256(file.bytes),
      afterSha256: sha256(updatedBytes),
      summary: "Corrected an unambiguous local asset filename reference.",
      requiresCustomerAttention: false,
    }));
    return { path: file.path, bytes: updatedBytes };
  });
}

export function normalizeStaticProjectDeterministically(
  input: DeterministicNormalizationInput,
): DeterministicNormalizationResult {
  try {
    assertStaticMvpPlan(input.plan);
  } catch {
    throw new PocketCloudError({
      code: "PROJECT_UNSUPPORTED",
      customerMessage: "This project is outside the static-site MVP policy.",
      retryable: false,
    });
  }

  const changes: NormalizationChangeV1[] = [];
  const prefix = input.plan.projectRoot === "." ? "" : `${input.plan.projectRoot}/`;
  const outputFiles: StaticProjectFile[] = [];
  const outputPaths = new Set<string>();

  for (const inputFile of input.files) {
    const insideProject = prefix === "" || inputFile.path.startsWith(prefix);
    if (!insideProject && !isKnownIrrelevantMetadata(inputFile.path)) {
      throw new PocketCloudError({
        code: "NORMALIZATION_FAILED",
        customerMessage: "The wrapper directory contains unexpected sibling content.",
        retryable: false,
      });
    }
    if (isKnownIrrelevantMetadata(inputFile.path)) {
      changes.push(createNormalizationChange({
        source: "deterministic",
        ruleCode: "REMOVE_IRRELEVANT_METADATA",
        operation: "delete",
        path: inputFile.path,
        beforeSha256: sha256(inputFile.bytes),
        summary: "Removed known operating-system metadata from the deployable copy.",
        requiresCustomerAttention: false,
      }));
      continue;
    }
    const outputPath = prefix === "" ? inputFile.path : inputFile.path.slice(prefix.length);
    if (outputPaths.has(outputPath)) {
      throw new PocketCloudError({
        code: "NORMALIZATION_FAILED",
        customerMessage: "The project cannot be normalized without overwriting a file.",
        retryable: false,
      });
    }
    outputPaths.add(outputPath);
    outputFiles.push(cloneFile(inputFile, outputPath));
    if (prefix !== "") {
      changes.push(createNormalizationChange({
        source: "deterministic",
        ruleCode: "MOVE_WRAPPER",
        operation: "move",
        path: outputPath,
        previousPath: inputFile.path,
        beforeSha256: sha256(inputFile.bytes),
        afterSha256: sha256(inputFile.bytes),
        summary: "Moved a wrapped site file to the canonical deployment root.",
        requiresCustomerAttention: false,
      }));
    }
  }

  const capitalized = fixReferenceCapitalization(
    outputFiles.sort((left, right) => left.path.localeCompare(right.path)),
    changes,
  );
  const inspection = inspectStaticProject(capitalized);
  const nonRepairable = inspection.findings.find((finding) => !finding.repairable);
  if (nonRepairable) failForNonRepairableFinding(nonRepairable);

  return {
    files: capitalized.map((file) => cloneFile(file)),
    changes,
    findings: inspection.findings,
  };
}
