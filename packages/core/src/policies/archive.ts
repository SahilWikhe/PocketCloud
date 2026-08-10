export const archivePolicy = Object.freeze({
  maximumCompressedBytes: 10 * 1024 * 1024,
  maximumExpandedBytes: 50 * 1024 * 1024,
  maximumFileCount: 500,
  maximumSingleFileBytes: 10 * 1024 * 1024,
  maximumDirectoryDepth: 12,
  maximumProcessingMilliseconds: 120_000,
});

export interface ArchivePolicy {
  maximumCompressedBytes: number;
  maximumExpandedBytes: number;
  maximumFileCount: number;
  maximumSingleFileBytes: number;
  maximumDirectoryDepth: number;
  maximumProcessingMilliseconds: number;
}
