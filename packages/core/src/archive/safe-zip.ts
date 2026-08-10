import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import yauzl, { type Entry, type ZipFile } from "yauzl";

import { PocketCloudError } from "../errors/index";
import { archivePolicy, type ArchivePolicy } from "../policies/archive";

const nestedArchiveExtensions = new Set([
  ".7z",
  ".bz2",
  ".gz",
  ".rar",
  ".tar",
  ".tgz",
  ".xz",
  ".zip",
]);
const unixFileTypeMask = 0o170000;
const unixRegularFile = 0o100000;
const unixDirectory = 0o040000;

export interface ExtractedArchiveFile {
  path: string;
  bytes: Uint8Array;
}

export interface SafeZipOptions {
  policy?: Partial<ArchivePolicy>;
  now?: () => number;
}

function archiveError(
  code: "ARCHIVE_LIMIT_EXCEEDED" | "ARCHIVE_UNSAFE_PATH" | "FILE_TYPE_NOT_ALLOWED",
  customerMessage: string,
): PocketCloudError {
  return new PocketCloudError({ code, customerMessage, retryable: false });
}

function completePolicy(overrides: Partial<ArchivePolicy> | undefined): ArchivePolicy {
  const policy = { ...archivePolicy, ...overrides };
  for (const value of Object.values(policy)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new TypeError("Archive policy limits must be positive integers");
    }
  }
  return policy;
}

function checkElapsed(startedAt: number, now: () => number, policy: ArchivePolicy): void {
  if (now() - startedAt > policy.maximumProcessingMilliseconds) {
    throw archiveError(
      "ARCHIVE_LIMIT_EXCEEDED",
      "The archive took too long to inspect safely.",
    );
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function validateEntryPath(entryName: string, directory: boolean, policy: ArchivePolicy): string {
  const withoutTrailingSlash = directory ? entryName.replace(/\/+$/, "") : entryName;
  if (
    withoutTrailingSlash.length === 0 ||
    withoutTrailingSlash !== withoutTrailingSlash.normalize("NFC") ||
    withoutTrailingSlash.startsWith("/") ||
    withoutTrailingSlash.startsWith("\\") ||
    /^[A-Za-z]:/.test(withoutTrailingSlash) ||
    withoutTrailingSlash.includes("\\") ||
    hasControlCharacter(withoutTrailingSlash)
  ) {
    throw archiveError("ARCHIVE_UNSAFE_PATH", "The archive contains an unsafe file path.");
  }

  const segments = withoutTrailingSlash.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw archiveError("ARCHIVE_UNSAFE_PATH", "The archive contains an unsafe file path.");
  }
  const directoryDepth = directory ? segments.length : segments.length - 1;
  if (directoryDepth > policy.maximumDirectoryDepth) {
    throw archiveError(
      "ARCHIVE_LIMIT_EXCEEDED",
      "The archive contains a directory structure that is too deep.",
    );
  }
  return segments.join("/");
}

function unixFileType(entry: Entry): number {
  return (entry.externalFileAttributes >>> 16) & unixFileTypeMask;
}

function isDirectoryEntry(entry: Entry): boolean {
  return entry.fileName.endsWith("/") || unixFileType(entry) === unixDirectory;
}

function validateEntryKind(entry: Entry, directory: boolean): void {
  const type = unixFileType(entry);
  if (type !== 0 && type !== unixRegularFile && type !== unixDirectory) {
    throw archiveError(
      "ARCHIVE_UNSAFE_PATH",
      "The archive contains a link or unsupported filesystem entry.",
    );
  }
  if ((type === unixDirectory) !== directory && type !== 0) {
    throw archiveError(
      "ARCHIVE_UNSAFE_PATH",
      "The archive contains inconsistent filesystem metadata.",
    );
  }
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw archiveError("FILE_TYPE_NOT_ALLOWED", "Encrypted archive entries are not supported.");
  }
  if (!directory && entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw archiveError(
      "FILE_TYPE_NOT_ALLOWED",
      "The archive uses an unsupported compression method.",
    );
  }
}

function validateNoAlias(
  normalizedPath: string,
  directory: boolean,
  seenEntries: Map<string, "directory" | "file">,
): void {
  const aliasKey = normalizedPath.toLocaleLowerCase("en-US");
  const existing = seenEntries.get(aliasKey);
  if (existing && (existing === "file" || !directory)) {
    throw archiveError(
      "ARCHIVE_UNSAFE_PATH",
      "The archive contains duplicate or aliased file paths.",
    );
  }
  const segments = normalizedPath.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const parent = segments.slice(0, index).join("/").toLocaleLowerCase("en-US");
    if (seenEntries.get(parent) === "file") {
      throw archiveError(
        "ARCHIVE_UNSAFE_PATH",
        "The archive contains conflicting file and directory paths.",
      );
    }
    if (!seenEntries.has(parent)) {
      seenEntries.set(parent, "directory");
    }
  }
  seenEntries.set(aliasKey, directory ? "directory" : "file");
}

function openZip(archive: Uint8Array): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      Buffer.from(archive),
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: false },
      (error, zipFile) => {
        if (error || !zipFile) {
          reject(
            archiveError("ARCHIVE_UNSAFE_PATH", "The uploaded ZIP archive is malformed."),
          );
          return;
        }
        resolve(zipFile);
      },
    );
  });
}

function readEntry(
  zipFile: ZipFile,
  entry: Entry,
  maximumBytes: number,
  checkTime: () => void,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (openError, stream) => {
      if (openError || !stream) {
        reject(archiveError("ARCHIVE_UNSAFE_PATH", "An archive entry could not be read safely."));
        return;
      }
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      stream.on("data", (chunk: Buffer) => {
        try {
          checkTime();
          totalBytes += chunk.byteLength;
          if (totalBytes > maximumBytes) {
            stream.destroy(
              archiveError(
                "ARCHIVE_LIMIT_EXCEEDED",
                "A file in the archive is larger than the allowed limit.",
              ),
            );
            return;
          }
          chunks.push(Buffer.from(chunk));
        } catch (error) {
          stream.destroy(error as Error);
        }
      });
      stream.once("error", reject);
      stream.once("end", () => resolve(Buffer.concat(chunks, totalBytes)));
    });
  });
}

export async function inspectAndExtractZip(
  archive: Uint8Array,
  options: SafeZipOptions = {},
): Promise<readonly ExtractedArchiveFile[]> {
  const policy = completePolicy(options.policy);
  const now = options.now ?? Date.now;
  const startedAt = now();
  if (!(archive instanceof Uint8Array) || archive.byteLength === 0) {
    throw archiveError("ARCHIVE_UNSAFE_PATH", "The uploaded ZIP archive is empty or invalid.");
  }
  if (archive.byteLength > policy.maximumCompressedBytes) {
    throw archiveError(
      "ARCHIVE_LIMIT_EXCEEDED",
      "The compressed archive is larger than the allowed limit.",
    );
  }

  const zipFile = await openZip(archive);
  const seenEntries = new Map<string, "directory" | "file">();
  const files: ExtractedArchiveFile[] = [];
  let expandedBytes = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(
        error instanceof PocketCloudError
          ? error
          : archiveError("ARCHIVE_UNSAFE_PATH", "The uploaded ZIP archive is malformed."),
      );
    };

    zipFile.once("error", fail);
    zipFile.once("end", () => {
      if (settled) return;
      settled = true;
      resolve(files.sort((left, right) => left.path.localeCompare(right.path)));
    });
    zipFile.on("entry", (entry: Entry) => {
      void (async () => {
        checkElapsed(startedAt, now, policy);
        const directory = isDirectoryEntry(entry);
        validateEntryKind(entry, directory);
        const normalizedPath = validateEntryPath(entry.fileName, directory, policy);
        validateNoAlias(normalizedPath, directory, seenEntries);
        if (directory) {
          zipFile.readEntry();
          return;
        }
        if (nestedArchiveExtensions.has(path.posix.extname(normalizedPath).toLowerCase())) {
          throw archiveError(
            "FILE_TYPE_NOT_ALLOWED",
            "Archives nested inside an upload are not supported.",
          );
        }
        if (files.length + 1 > policy.maximumFileCount) {
          throw archiveError(
            "ARCHIVE_LIMIT_EXCEEDED",
            "The archive contains more files than the allowed limit.",
          );
        }
        if (entry.uncompressedSize > policy.maximumSingleFileBytes) {
          throw archiveError(
            "ARCHIVE_LIMIT_EXCEEDED",
            "A file in the archive is larger than the allowed limit.",
          );
        }
        if (expandedBytes + entry.uncompressedSize > policy.maximumExpandedBytes) {
          throw archiveError(
            "ARCHIVE_LIMIT_EXCEEDED",
            "The expanded archive is larger than the allowed limit.",
          );
        }
        const bytes = await readEntry(
          zipFile,
          entry,
          policy.maximumSingleFileBytes,
          () => checkElapsed(startedAt, now, policy),
        );
        expandedBytes += bytes.byteLength;
        if (expandedBytes > policy.maximumExpandedBytes) {
          throw archiveError(
            "ARCHIVE_LIMIT_EXCEEDED",
            "The expanded archive is larger than the allowed limit.",
          );
        }
        files.push({ path: normalizedPath, bytes: Uint8Array.from(bytes) });
        zipFile.readEntry();
      })().catch(fail);
    });
    zipFile.readEntry();
  });
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function extractZipArchive(
  archive: Uint8Array,
  outputDirectory: string,
  options: SafeZipOptions = {},
): Promise<readonly string[]> {
  const files = await inspectAndExtractZip(archive, options);
  const resolvedOutput = path.resolve(outputDirectory);
  const parent = path.dirname(resolvedOutput);
  await mkdir(parent, { recursive: true });
  if (await pathExists(resolvedOutput)) {
    throw new PocketCloudError({
      code: "CONFLICT",
      customerMessage: "The assigned extraction directory is already in use.",
      retryable: false,
    });
  }
  const temporaryDirectory = await mkdtemp(path.join(parent, ".pocketcloud-extract-"));
  try {
    for (const file of files) {
      const destination = path.resolve(temporaryDirectory, ...file.path.split("/"));
      const relative = path.relative(temporaryDirectory, destination);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw archiveError("ARCHIVE_UNSAFE_PATH", "The archive contains an unsafe file path.");
      }
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.bytes, { flag: "wx", mode: 0o600 });
    }
    await rename(temporaryDirectory, resolvedOutput);
    return files.map((file) => file.path);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}
