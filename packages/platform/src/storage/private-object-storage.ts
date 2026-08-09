export interface StoredObjectMetadata {
  storageKey: string;
  size: number;
  contentType: string;
  etag?: string;
  uploadedAt: string;
}

export interface ClientUploadAuthorization {
  uploadId: string;
  pathname: string;
  contentType: "application/zip";
  maximumSizeInBytes: number;
  validUntil: number;
}

export interface ClientUploadAuthorizationRequest {
  pathname: string;
  clientPayload: string | null;
}

export interface PrivateObjectStorage {
  readonly provider: string;
  stat(storageKey: string): Promise<StoredObjectMetadata | null>;
  read(storageKey: string): AsyncIterable<Uint8Array>;
  write(storageKey: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(storageKey: string): Promise<void>;
}

export interface ClientUploadStorage extends PrivateObjectStorage {
  handleClientUpload(
    request: Request | NodeJS.ReadableStream,
    body: unknown,
    authorize: (
      request: ClientUploadAuthorizationRequest,
    ) => Promise<ClientUploadAuthorization>,
  ): Promise<unknown>;
}
