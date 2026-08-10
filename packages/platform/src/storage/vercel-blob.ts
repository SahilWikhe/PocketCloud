import { del, get, head, issueSignedToken, put } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import type { IncomingMessage } from "node:http";

import type {
  ClientUploadAuthorizationRequest,
  ClientUploadStorage,
  StoredObjectMetadata,
} from "./private-object-storage";

export interface VercelBlobStorageOptions {
  token?: string;
}

export class VercelBlobPrivateObjectStorage implements ClientUploadStorage {
  readonly provider = "vercel_blob";
  private readonly token: string | undefined;

  constructor(options: VercelBlobStorageOptions = {}) {
    this.token = options.token;
  }

  async handleClientUpload(
    request: Request | NodeJS.ReadableStream,
    body: unknown,
    authorize: (
      request: ClientUploadAuthorizationRequest,
    ) => Promise<{
      uploadId: string;
      pathname: string;
      contentType: "application/zip";
      maximumSizeInBytes: number;
      validUntil: number;
    }>,
  ): Promise<unknown> {
    return handleUploadPresigned({
      request: request as Request | IncomingMessage,
      body: body as HandleUploadPresignedBody,
      getSignedToken: async (pathname, clientPayload) => {
        const authorization = await authorize({ pathname, clientPayload });
        if (authorization.pathname !== pathname) {
          throw new Error("Upload pathname does not match the authorized storage key");
        }
        return {
          token: await issueSignedToken({
            pathname,
            operations: ["put"],
            allowedContentTypes: [authorization.contentType],
            maximumSizeInBytes: authorization.maximumSizeInBytes,
            validUntil: authorization.validUntil,
            ...(this.token === undefined ? {} : { token: this.token }),
          }),
          urlOptions: {
            allowedContentTypes: [authorization.contentType],
            maximumSizeInBytes: authorization.maximumSizeInBytes,
            validUntil: authorization.validUntil,
            addRandomSuffix: false,
            allowOverwrite: false,
            tokenPayload: authorization.uploadId,
            cacheControlMaxAge: 60,
          },
        };
      },
    });
  }

  async stat(storageKey: string): Promise<StoredObjectMetadata | null> {
    try {
      const blob = await head(storageKey, this.token === undefined ? {} : { token: this.token });
      return {
        storageKey: blob.pathname,
        size: blob.size,
        contentType: blob.contentType,
        etag: blob.etag,
        uploadedAt: blob.uploadedAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "BlobNotFoundError") {
        return null;
      }
      throw error;
    }
  }

  async *read(storageKey: string): AsyncIterable<Uint8Array> {
    const result = await get(storageKey, {
      access: "private",
      useCache: false,
      ...(this.token === undefined ? {} : { token: this.token }),
    });
    if (!result || result.statusCode === 304 || !result.stream) {
      throw new Error("Private object was not found");
    }

    const reader = result.stream.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          return;
        }
        yield chunk.value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  async delete(storageKey: string): Promise<void> {
    await del(storageKey, this.token === undefined ? {} : { token: this.token });
  }

  async write(storageKey: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await put(storageKey, Buffer.from(bytes), {
      access: "private",
      allowOverwrite: false,
      addRandomSuffix: false,
      contentType,
      cacheControlMaxAge: 60,
      ...(this.token === undefined ? {} : { token: this.token }),
    });
  }
}
