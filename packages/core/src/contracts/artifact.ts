import { z } from "zod";

import {
  identifierSchema,
  isoDateTimeSchema,
  normalizedRelativePathSchema,
  sha256Schema,
} from "./common";

export const artifactKindSchema = z.enum([
  "original",
  "normalized",
  "build_output",
  "diagnostic",
]);

export const artifactFileSchema = z.object({
  path: normalizedRelativePathSchema,
  sha256: sha256Schema,
  size: z.number().int().nonnegative(),
  mediaType: z.string().min(1).nullable(),
});

export const artifactManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  artifactId: identifierSchema,
  kind: artifactKindSchema,
  sha256: sha256Schema,
  totalBytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  files: z.array(artifactFileSchema).readonly(),
  createdAt: isoDateTimeSchema,
}).superRefine((manifest, context) => {
  const paths = manifest.files.map((file) => file.path);
  const sorted = [...paths].sort((left, right) => left.localeCompare(right));
  if (new Set(paths).size !== paths.length) {
    context.addIssue({ code: "custom", message: "Artifact paths must be unique", path: ["files"] });
  }
  if (!paths.every((path, index) => path === sorted[index])) {
    context.addIssue({ code: "custom", message: "Artifact files must be path-sorted", path: ["files"] });
  }
  if (manifest.fileCount !== manifest.files.length) {
    context.addIssue({ code: "custom", message: "fileCount must equal files.length", path: ["fileCount"] });
  }
  const totalBytes = manifest.files.reduce((total, file) => total + file.size, 0);
  if (manifest.totalBytes !== totalBytes) {
    context.addIssue({ code: "custom", message: "totalBytes must equal file sizes", path: ["totalBytes"] });
  }
});

export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export type ArtifactFile = z.infer<typeof artifactFileSchema>;
export type ArtifactManifestV1 = z.infer<typeof artifactManifestV1Schema>;
