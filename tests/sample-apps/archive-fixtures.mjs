import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const MEBIBYTE = 1024 * 1024;
const MAXIMUM_FILE_COUNT = 500;
const MAXIMUM_SINGLE_FILE_BYTES = 10 * MEBIBYTE;
const MAXIMUM_EXPANDED_BYTES = 50 * MEBIBYTE;
const MAXIMUM_DIRECTORY_DEPTH = 12;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encode(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

/**
 * Creates a small standards-compliant ZIP without relying on an extraction tool.
 * The builder intentionally supports only the features needed by the fixture catalog.
 */
export function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const bytes = encode(entry.bytes ?? "");
    const compressionMethod = entry.compress === true ? 8 : 0;
    const compressed = compressionMethod === 8 ? deflateRawSync(bytes) : bytes;
    const checksum = crc32(bytes);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.byteLength, 18);
    localHeader.writeUInt32LE(bytes.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.byteLength, 20);
    centralHeader.writeUInt32LE(bytes.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(((entry.unixMode ?? 0o100644) << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.byteLength + name.byteLength + compressed.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function buildGeneratedArchiveFixtures() {
  const nestedZip = createZip([
    { name: "index.html", bytes: "<!doctype html><title>Nested fixture</title>" },
  ]);
  const excessiveDepthPath = [
    ...Array.from({ length: MAXIMUM_DIRECTORY_DEPTH + 1 }, (_, index) => `level-${index + 1}`),
    "file.txt",
  ].join("/");

  return new Map([
    [
      "excessive-directory-depth.zip",
      createZip([{ name: excessiveDepthPath, bytes: "too deep" }]),
    ],
    ["path-traversal.zip", createZip([{ name: "../outside.txt", bytes: "do not write" }])],
    ["absolute-path.zip", createZip([{ name: "/tmp/outside.txt", bytes: "do not write" }])],
    [
      "symlink.zip",
      createZip([
        { name: "site/index.html", bytes: "<!doctype html><title>Site</title>" },
        { name: "site/index-link.html", bytes: "index.html", unixMode: 0o120777 },
      ]),
    ],
    ["nested-zip.zip", createZip([{ name: "site/inner.zip", bytes: nestedZip }])],
    [
      "file-count-limit.zip",
      createZip(
        Array.from({ length: MAXIMUM_FILE_COUNT + 1 }, (_, index) => ({
          name: `files/file-${String(index + 1).padStart(3, "0")}.txt`,
          bytes: "",
        })),
      ),
    ],
    [
      "single-file-size-limit.zip",
      createZip([
        {
          name: "site/large.txt",
          bytes: Buffer.alloc(MAXIMUM_SINGLE_FILE_BYTES + 1),
          compress: true,
        },
      ]),
    ],
    [
      "expanded-size-limit.zip",
      createZip([
        {
          name: "site/expanded.txt",
          bytes: Buffer.alloc(MAXIMUM_EXPANDED_BYTES + 1),
          compress: true,
        },
      ]),
    ],
  ]);
}

export function buildGeneratedDirectoryFixtures() {
  return new Map([
    [
      "unexpected-binary-text-content",
      new Map([
        ["index.html", Buffer.from("<!doctype html><title>Binary text fixture</title>")],
        ["notes.txt", Buffer.from([0x00, 0xff, 0xfe, 0x41])],
      ]),
    ],
  ]);
}

function assertControlledTemporaryDirectory(outputDirectory) {
  const resolvedOutput = path.resolve(outputDirectory);
  const temporaryRoot = path.resolve(tmpdir());
  const relative = path.relative(temporaryRoot, resolvedOutput);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Generated hostile fixtures may only be written below the OS temporary directory");
  }
  return resolvedOutput;
}

export async function materializeGeneratedFixtures(outputDirectory) {
  const controlledRoot = assertControlledTemporaryDirectory(outputDirectory);
  const archiveDirectory = path.join(controlledRoot, "archives");
  const projectDirectory = path.join(controlledRoot, "projects");
  await mkdir(archiveDirectory, { recursive: true });
  await mkdir(projectDirectory, { recursive: true });

  for (const [archiveName, bytes] of buildGeneratedArchiveFixtures()) {
    await writeFile(path.join(archiveDirectory, archiveName), bytes, { flag: "wx" });
  }
  for (const [fixtureId, files] of buildGeneratedDirectoryFixtures()) {
    const fixtureDirectory = path.join(projectDirectory, fixtureId);
    await mkdir(fixtureDirectory, { recursive: true });
    for (const [relativePath, bytes] of files) {
      await writeFile(path.join(fixtureDirectory, relativePath), bytes, { flag: "wx" });
    }
  }

  return controlledRoot;
}
