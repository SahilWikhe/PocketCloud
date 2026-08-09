import type { PrivateObjectStorage, StoredObjectMetadata } from "./private-object-storage";

interface StoredMemoryObject {
  bytes: Uint8Array;
  contentType: string;
  uploadedAt: string;
}

export class MemoryPrivateObjectStorage implements PrivateObjectStorage {
  readonly provider = "memory";
  private readonly objects = new Map<string, StoredMemoryObject>();

  put(storageKey: string, bytes: Uint8Array, contentType = "application/zip"): void {
    if (this.objects.has(storageKey)) {
      throw new Error("Private objects are immutable");
    }
    this.objects.set(storageKey, {
      bytes: bytes.slice(),
      contentType,
      uploadedAt: new Date().toISOString(),
    });
  }

  async stat(storageKey: string): Promise<StoredObjectMetadata | null> {
    const object = this.objects.get(storageKey);
    if (!object) {
      return null;
    }
    return {
      storageKey,
      size: object.bytes.byteLength,
      contentType: object.contentType,
      uploadedAt: object.uploadedAt,
    };
  }

  async *read(storageKey: string): AsyncIterable<Uint8Array> {
    const object = this.objects.get(storageKey);
    if (!object) {
      throw new Error("Private object was not found");
    }
    yield object.bytes.slice();
  }

  async delete(storageKey: string): Promise<void> {
    this.objects.delete(storageKey);
  }

  async write(storageKey: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.put(storageKey, bytes, contentType);
  }
}
