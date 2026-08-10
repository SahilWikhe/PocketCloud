import { createHash } from "node:crypto";

import type { NormalizationChangeV1 } from "@pocketcloud/core";

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createNormalizationChange(
  change: Omit<NormalizationChangeV1, "schemaVersion" | "changeId">,
): NormalizationChangeV1 {
  const identity = JSON.stringify(change, Object.keys(change).sort());
  return {
    schemaVersion: 1,
    changeId: `change-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`,
    ...change,
  };
}
