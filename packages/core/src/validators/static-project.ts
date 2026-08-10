import path from "node:path";

import { normalizedRelativePathSchema } from "../contracts/common";
import { PocketCloudError, type PocketCloudErrorCode } from "../errors/index";
import { archivePolicy } from "../policies/archive";

export interface StaticProjectFile {
  path: string;
  bytes: Uint8Array;
}

export type StaticProjectFindingCode =
  | "FILE_TYPE_NOT_ALLOWED"
  | "ENTRYPOINT_MISSING"
  | "MISSING_LOCAL_REFERENCE"
  | "REFERENCE_CAPITALIZATION_MISMATCH"
  | "LOCAL_ABSOLUTE_PATH"
  | "LOCALHOST_REFERENCE"
  | "PROJECT_BUDGET_EXCEEDED";

export interface StaticProjectFinding {
  code: StaticProjectFindingCode;
  path?: string;
  reference?: string;
  resolvedPath?: string;
  summary: string;
  repairable: boolean;
}

export interface StaticProjectInspection {
  findings: readonly StaticProjectFinding[];
  references: readonly { path: string; reference: string }[];
}

const textExtensions = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".txt"]);
const binaryExtensions = new Set([
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
  ".woff",
  ".woff2",
]);
const secretNames = [
  /^\.env(?:\.|$)/i,
  /(?:^|[-_.])(credential|credentials|secret|secrets|token|tokens)(?:[-_.]|$)/i,
  /(?:^|\/)(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)$/i,
  /\.(?:key|p12|pfx|pem)$/i,
];
const referencePattern = /(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi;

export const allowedStaticTextExtensions = Object.freeze([...textExtensions].sort());
export const allowedStaticBinaryExtensions = Object.freeze([...binaryExtensions].sort());

export function isKnownIrrelevantMetadata(filePath: string): boolean {
  return (
    filePath === ".DS_Store" ||
    filePath.endsWith("/.DS_Store") ||
    filePath === "Thumbs.db" ||
    filePath.endsWith("/Thumbs.db") ||
    filePath === "__MACOSX" ||
    filePath.startsWith("__MACOSX/") ||
    filePath.includes("/__MACOSX/")
  );
}

export function isSecretBearingPath(filePath: string): boolean {
  return secretNames.some((pattern) => pattern.test(filePath));
}

export function isAllowedStaticPath(filePath: string): boolean {
  const extension = path.posix.extname(filePath).toLowerCase();
  const rootProviderConfig = !filePath.includes("/") && ["now.json", "vercel.json", "vercel.ts"].includes(filePath.toLowerCase());
  return (
    !rootProviderConfig &&
    (textExtensions.has(extension) || binaryExtensions.has(extension)) &&
    !isSecretBearingPath(filePath)
  );
}

export function decodeStaticText(file: StaticProjectFile): string | null {
  const extension = path.posix.extname(file.path).toLowerCase();
  if (!textExtensions.has(extension) || file.bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch {
    return null;
  }
}

function hasExpectedSignature(file: StaticProjectFile): boolean {
  const bytes = file.bytes;
  const extension = path.posix.extname(file.path).toLowerCase();
  if (textExtensions.has(extension)) return decodeStaticText(file) !== null;
  if (extension === ".png") return bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === ".jpg" || extension === ".jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (extension === ".gif") return Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF87a" || Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF89a";
  if (extension === ".webp") return Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
  if (extension === ".ico") return bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
  if (extension === ".woff") return Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "wOFF";
  if (extension === ".woff2") return Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "wOF2";
  return false;
}

export function collectStaticReferences(files: readonly StaticProjectFile[]): readonly { path: string; reference: string }[] {
  const references: { path: string; reference: string }[] = [];
  for (const file of files) {
    const text = decodeStaticText(file);
    if (text === null) continue;
    referencePattern.lastIndex = 0;
    for (const match of text.matchAll(referencePattern)) {
      const reference = (match[1] ?? match[2])?.trim();
      if (reference) references.push({ path: file.path, reference });
    }
  }
  return references;
}

function isLocalhostReference(reference: string): boolean {
  try {
    const parsed = new URL(reference);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  } catch {
    return /^\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(reference);
  }
}

function isLocalAbsoluteReference(reference: string): boolean {
  return /^file:\/\//i.test(reference) || /^[A-Za-z]:[\\/]/.test(reference) || /^\/(?:Users|home|var|tmp|etc)\//.test(reference);
}

function localReferencePath(sourcePath: string, reference: string): string | null {
  const withoutQuery = reference.split(/[?#]/, 1)[0] ?? "";
  if (
    withoutQuery === "" ||
    withoutQuery.startsWith("#") ||
    withoutQuery.startsWith("/") ||
    withoutQuery.startsWith("//") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(withoutQuery)
  ) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), withoutQuery));
  if (resolved === ".." || resolved.startsWith("../") || !normalizedRelativePathSchema.safeParse(resolved).success) return null;
  return resolved;
}

export function inspectStaticProject(files: readonly StaticProjectFile[]): StaticProjectInspection {
  const findings: StaticProjectFinding[] = [];
  const paths = new Set(files.map((file) => file.path));
  const caseInsensitivePaths = new Map<string, string[]>();
  let totalBytes = 0;

  if (!paths.has("index.html")) {
    findings.push({
      code: "ENTRYPOINT_MISSING",
      path: "index.html",
      summary: "The normalized project must contain index.html at its root.",
      repairable: false,
    });
  }
  for (const file of files) {
    totalBytes += file.bytes.byteLength;
    const key = file.path.toLocaleLowerCase("en-US");
    caseInsensitivePaths.set(key, [...(caseInsensitivePaths.get(key) ?? []), file.path]);
    if (
      !normalizedRelativePathSchema.safeParse(file.path).success ||
      !isAllowedStaticPath(file.path) ||
      !hasExpectedSignature(file)
    ) {
      findings.push({
        code: "FILE_TYPE_NOT_ALLOWED",
        path: file.path,
        summary: "The project contains a file that is not allowed for static deployment.",
        repairable: false,
      });
    }
    if (file.bytes.byteLength > archivePolicy.maximumSingleFileBytes) {
      findings.push({
        code: "PROJECT_BUDGET_EXCEEDED",
        path: file.path,
        summary: "A project file is larger than the static deployment limit.",
        repairable: false,
      });
    }
  }
  if (files.length > archivePolicy.maximumFileCount || totalBytes > archivePolicy.maximumExpandedBytes) {
    findings.push({
      code: "PROJECT_BUDGET_EXCEEDED",
      summary: "The normalized project exceeds the static deployment budget.",
      repairable: false,
    });
  }

  const references = collectStaticReferences(files);
  for (const { path: sourcePath, reference } of references) {
    if (isLocalhostReference(reference)) {
      findings.push({
        code: "LOCALHOST_REFERENCE",
        path: sourcePath,
        reference,
        summary: "A page still references a local development server.",
        repairable: true,
      });
      continue;
    }
    if (isLocalAbsoluteReference(reference)) {
      findings.push({
        code: "LOCAL_ABSOLUTE_PATH",
        path: sourcePath,
        reference,
        summary: "A page still references a developer-local filesystem path.",
        repairable: true,
      });
      continue;
    }
    const resolved = localReferencePath(sourcePath, reference);
    if (resolved === null || paths.has(resolved)) continue;
    const matches = caseInsensitivePaths.get(resolved.toLocaleLowerCase("en-US")) ?? [];
    if (matches.length === 1) {
      findings.push({
        code: "REFERENCE_CAPITALIZATION_MISMATCH",
        path: sourcePath,
        reference,
        resolvedPath: matches[0]!,
        summary: "A local asset reference uses different filename capitalization.",
        repairable: true,
      });
    } else {
      findings.push({
        code: "MISSING_LOCAL_REFERENCE",
        path: sourcePath,
        reference,
        summary: "A referenced local asset is missing from the project.",
        repairable: true,
      });
    }
  }

  return { findings, references };
}

function errorCodeForFinding(finding: StaticProjectFinding): PocketCloudErrorCode {
  if (finding.code === "ENTRYPOINT_MISSING") return "ENTRYPOINT_MISSING";
  if (finding.code === "FILE_TYPE_NOT_ALLOWED") return "FILE_TYPE_NOT_ALLOWED";
  return "VALIDATION_FAILED";
}

export function validateStaticProject(files: readonly StaticProjectFile[]): StaticProjectInspection {
  const inspection = inspectStaticProject(files);
  const finding = inspection.findings[0];
  if (finding) {
    throw new PocketCloudError({
      code: errorCodeForFinding(finding),
      customerMessage: finding.summary,
      retryable: false,
    });
  }
  return inspection;
}
