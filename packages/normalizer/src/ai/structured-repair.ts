import {
  PocketCloudError,
  type NormalizationChangeV1,
} from "@pocketcloud/core";
import {
  decodeStaticText,
  inspectStaticProject,
  isAllowedStaticPath,
  isSecretBearingPath,
  validateStaticProject,
  type StaticProjectFile,
  type StaticProjectFinding,
} from "@pocketcloud/core/execution";

import { createNormalizationChange, sha256 } from "../change-log/change";
import {
  aiPatchResponseSchema,
  maximumAiPatchOperations,
} from "../patches/schema";

const maximumSelectedFileBytes = 16 * 1024;
const maximumSelectedBytes = 48 * 1024;
const maximumEstimatedInputTokens = 12_000;
const maximumOutputTokens = 2_000;
const maximumPatchedBytes = 64 * 1024;
const aiRepairableFindingCodes = new Set([
  "MISSING_LOCAL_REFERENCE",
  "LOCAL_ABSOLUTE_PATH",
  "LOCALHOST_REFERENCE",
]);

export interface AiRepairRequest {
  schemaVersion: 1;
  files: readonly { path: string; content: string }[];
  findings: readonly Pick<StaticProjectFinding, "code" | "path" | "reference" | "summary">[];
  limits: {
    maximumPatches: typeof maximumAiPatchOperations;
    maximumPatchedBytes: number;
    commandsAllowed: false;
  };
}

export interface AiRepairClient {
  proposePatch(request: AiRepairRequest): Promise<unknown>;
}

export interface StructuredAiRepairResult {
  files: readonly StaticProjectFile[];
  changes: readonly NormalizationChangeV1[];
  usage: { inputTokens: number; outputTokens: number } | null;
  attempted: boolean;
}

function patchRejected(): PocketCloudError {
  return new PocketCloudError({
    code: "AI_PATCH_REJECTED",
    customerMessage: "The proposed repair did not pass PocketCloud's safety checks.",
    retryable: false,
  });
}

function selectFiles(files: readonly StaticProjectFile[], findings: readonly StaticProjectFinding[]): readonly { path: string; content: string }[] {
  const mentioned = new Set(findings.flatMap((finding) => finding.path ? [finding.path] : []));
  const ordered = [...files].sort((left, right) => {
    const leftPriority = left.path === "index.html" ? 0 : mentioned.has(left.path) ? 1 : 2;
    const rightPriority = right.path === "index.html" ? 0 : mentioned.has(right.path) ? 1 : 2;
    return leftPriority - rightPriority || left.path.localeCompare(right.path);
  });
  const selected: { path: string; content: string }[] = [];
  let selectedBytes = 0;
  for (const file of ordered) {
    if (isSecretBearingPath(file.path) || file.bytes.byteLength > maximumSelectedFileBytes) continue;
    const content = decodeStaticText(file);
    if (content === null || selectedBytes + file.bytes.byteLength > maximumSelectedBytes) continue;
    selected.push({ path: file.path, content });
    selectedBytes += file.bytes.byteLength;
  }
  if (selected.length === 0 || Math.ceil(selectedBytes / 4) > maximumEstimatedInputTokens) {
    throw new PocketCloudError({
      code: "AI_BUDGET_EXCEEDED",
      customerMessage: "This project is too large for the bounded repair attempt.",
      retryable: false,
    });
  }
  return selected;
}

function applyPatches(
  files: readonly StaticProjectFile[],
  response: ReturnType<typeof aiPatchResponseSchema.parse>,
): { files: readonly StaticProjectFile[]; changes: readonly NormalizationChangeV1[] } {
  const output = new Map(files.map((file) => [file.path, { path: file.path, bytes: Uint8Array.from(file.bytes) }]));
  const paths = new Set<string>();
  let patchedBytes = 0;
  const changes: NormalizationChangeV1[] = [];
  for (const patch of response.patches) {
    if (
      paths.has(patch.path) ||
      isSecretBearingPath(patch.path) ||
      !isAllowedStaticPath(patch.path) ||
      (patch.operation === "delete" && patch.path === "index.html")
    ) throw patchRejected();
    paths.add(patch.path);
    const existing = output.get(patch.path);
    if ((patch.operation === "create" && existing) || (patch.operation !== "create" && !existing)) {
      throw patchRejected();
    }
    if (patch.operation === "delete") {
      output.delete(patch.path);
      changes.push(createNormalizationChange({
        source: "ai",
        ruleCode: "AI_DELETE_FILE",
        operation: "delete",
        path: patch.path,
        beforeSha256: sha256(existing!.bytes),
        summary: "Removed one file as part of the bounded repair.",
        requiresCustomerAttention: true,
      }));
      continue;
    }
    const bytes = new TextEncoder().encode(patch.content!);
    patchedBytes += bytes.byteLength;
    if (
      bytes.includes(0) ||
      patchedBytes > maximumPatchedBytes ||
      decodeStaticText({ path: patch.path, bytes }) === null
    ) throw patchRejected();
    output.set(patch.path, { path: patch.path, bytes });
    changes.push(createNormalizationChange({
      source: "ai",
      ruleCode: patch.operation === "create" ? "AI_CREATE_FILE" : "AI_MODIFY_FILE",
      operation: patch.operation === "create" ? "create" : "modify",
      path: patch.path,
      ...(existing ? { beforeSha256: sha256(existing.bytes) } : {}),
      afterSha256: sha256(bytes),
      summary: patch.operation === "create"
        ? "Created one text file as part of the bounded repair."
        : "Updated one text file as part of the bounded repair.",
      requiresCustomerAttention: true,
    }));
  }
  return {
    files: [...output.values()].sort((left, right) => left.path.localeCompare(right.path)),
    changes,
  };
}

export async function repairStaticProjectWithAi(
  files: readonly StaticProjectFile[],
  findings: readonly StaticProjectFinding[],
  client: AiRepairClient,
): Promise<StructuredAiRepairResult> {
  if (findings.length === 0) {
    return { files: files.map((file) => ({ path: file.path, bytes: Uint8Array.from(file.bytes) })), changes: [], usage: null, attempted: false };
  }
  if (findings.some((finding) => !finding.repairable || !aiRepairableFindingCodes.has(finding.code))) {
    throw new PocketCloudError({
      code: "NORMALIZATION_FAILED",
      customerMessage: "The remaining project issue is not eligible for automated repair.",
      retryable: false,
    });
  }
  const selectedFiles = selectFiles(files, findings);
  let rawResponse: unknown;
  try {
    rawResponse = await client.proposePatch({
      schemaVersion: 1,
      files: selectedFiles,
      findings: findings.map(({ code, path, reference, summary }) => ({
        code,
        ...(path === undefined ? {} : { path }),
        ...(reference === undefined ? {} : { reference }),
        summary,
      })),
      limits: {
        maximumPatches: maximumAiPatchOperations,
        maximumPatchedBytes,
        commandsAllowed: false,
      },
    });
  } catch {
    throw new PocketCloudError({
      code: "INTERNAL_RETRYABLE",
      customerMessage: "The repair service is temporarily unavailable. Please try again.",
      retryable: true,
    });
  }
  const parsed = aiPatchResponseSchema.safeParse(rawResponse);
  if (!parsed.success || parsed.data.usage.outputTokens > maximumOutputTokens || parsed.data.usage.inputTokens > maximumEstimatedInputTokens) {
    throw parsed.success
      ? new PocketCloudError({ code: "AI_BUDGET_EXCEEDED", customerMessage: "The repair attempt exceeded its token budget.", retryable: false })
      : patchRejected();
  }
  const applied = applyPatches(files, parsed.data);
  validateStaticProject(applied.files);
  if (inspectStaticProject(applied.files).findings.length > 0) throw patchRejected();
  return {
    ...applied,
    usage: parsed.data.usage,
    attempted: true,
  };
}
