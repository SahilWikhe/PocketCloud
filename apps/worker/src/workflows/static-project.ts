import {
  PocketCloudError,
  type NormalizationChangeV1,
  type ProjectPlanV1,
} from "@pocketcloud/core";
import {
  analyzeStaticProject,
  inspectAndExtractZip,
  validateStaticProject,
  type StaticProjectFile,
} from "@pocketcloud/core/execution";
import {
  normalizeStaticProjectDeterministically,
  repairStaticProjectWithAi,
  type AiRepairClient,
} from "@pocketcloud/normalizer";

export interface StaticProjectAnalysis {
  files: readonly StaticProjectFile[];
  plan: ProjectPlanV1;
}

export interface StaticProjectNormalization {
  files: readonly StaticProjectFile[];
  changes: readonly NormalizationChangeV1[];
  aiUsage: { inputTokens: number; outputTokens: number } | null;
}

export interface StaticProjectProcessor {
  analyze(archiveBytes: Uint8Array): Promise<StaticProjectAnalysis>;
  normalize(analysis: StaticProjectAnalysis): Promise<StaticProjectNormalization>;
  validate(normalization: StaticProjectNormalization): Promise<void>;
}

export class DefaultStaticProjectProcessor implements StaticProjectProcessor {
  constructor(private readonly aiClient?: AiRepairClient) {}

  async analyze(archiveBytes: Uint8Array): Promise<StaticProjectAnalysis> {
    const files = await inspectAndExtractZip(archiveBytes);
    return { files, plan: analyzeStaticProject(files) };
  }

  async normalize(analysis: StaticProjectAnalysis): Promise<StaticProjectNormalization> {
    const deterministic = normalizeStaticProjectDeterministically(analysis);
    if (deterministic.findings.length === 0) {
      return { files: deterministic.files, changes: deterministic.changes, aiUsage: null };
    }
    if (!this.aiClient) {
      throw new PocketCloudError({
        code: "NORMALIZATION_FAILED",
        customerMessage: "The project needs a bounded repair, but the repair service is unavailable.",
        retryable: false,
      });
    }
    const repaired = await repairStaticProjectWithAi(
      deterministic.files,
      deterministic.findings,
      this.aiClient,
    );
    return {
      files: repaired.files,
      changes: [...deterministic.changes, ...repaired.changes],
      aiUsage: repaired.usage,
    };
  }

  async validate(normalization: StaticProjectNormalization): Promise<void> {
    validateStaticProject(normalization.files);
  }
}
