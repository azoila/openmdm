/**
 * OpenMDM S3 Storage Adapter
 *
 * Provides S3 storage for APK files with presigned URL support.
 * Compatible with AWS S3 and S3-compatible services (MinIO, DigitalOcean Spaces, etc.)
 *
 * @example
 * ```typescript
 * import { createMDM } from '@openmdm/core';
 * import { s3StorageAdapter } from '@openmdm/storage-s3';
 *
 * const mdm = createMDM({
 *   database: drizzleAdapter(db),
 *   storage: s3StorageAdapter({
 *     bucket: 'my-mdm-bucket',
 *     region: 'us-east-1',
 *     // credentials from environment or explicit
 *   }),
 * });
 *
 * // Get presigned upload URL
 * const { uploadUrl, key } = await mdm.storage.getUploadUrl({
 *   filename: 'app-v1.0.0.apk',
 *   contentType: 'application/vnd.android.package-archive',
 * });
 *
 * // After upload, confirm and get download URL
 * const downloadUrl = await mdm.storage.getDownloadUrl(key);
 * ```
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ============================================
// Types
// ============================================

export interface S3StorageOptions {
  /**
   * S3 bucket name
   */
  bucket: string;

  /**
   * AWS region
   */
  region: string;

  /**
   * AWS access key ID (optional - can use environment/IAM role)
   */
  accessKeyId?: string;

  /**
   * AWS secret access key (optional - can use environment/IAM role)
   */
  secretAccessKey?: string;

  /**
   * Custom endpoint for S3-compatible services (MinIO, DigitalOcean Spaces)
   */
  endpoint?: string;

  /**
   * Force path style URLs (required for some S3-compatible services)
   */
  forcePathStyle?: boolean;

  /**
   * Presigned URL expiration in seconds (default: 3600 = 1 hour)
   */
  presignedUrlExpiry?: number;

  /**
   * Download URL expiration in seconds (default: 86400 = 24 hours)
   */
  downloadUrlExpiry?: number;

  /**
   * Key prefix for all objects (e.g., 'mdm/apks/')
   */
  keyPrefix?: string;

  /**
   * Public URL base for objects (if bucket is publicly accessible)
   * If set, getDownloadUrl returns public URLs instead of presigned
   */
  publicUrlBase?: string;

  /**
   * Default ACL for uploaded objects
   */
  acl?: 'private' | 'public-read' | 'authenticated-read';

  /**
   * Enable server-side encryption
   */
  serverSideEncryption?: 'AES256' | 'aws:kms';

  /**
   * KMS key ID for encryption (if using aws:kms)
   */
  kmsKeyId?: string;
}

export interface StorageAdapter {
  /**
   * Get presigned URL for uploading a file
   */
  getUploadUrl(options: UploadUrlOptions): Promise<PresignedUploadResult>;

  /**
   * Get URL for downloading a file
   */
  getDownloadUrl(key: string, expiresIn?: number): Promise<string>;

  /**
   * Delete a file
   */
  delete(key: string): Promise<void>;

  /**
   * Check if file exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get file metadata
   */
  getMetadata(key: string): Promise<FileMetadata | null>;

  /**
   * List files with optional prefix
   */
  list(prefix?: string, maxKeys?: number): Promise<FileListResult>;

  /**
   * Copy file to new location
   */
  copy(sourceKey: string, destinationKey: string): Promise<void>;

  /**
   * Upload file directly (for server-side uploads)
   */
  upload(key: string, data: Buffer | Uint8Array, options?: DirectUploadOptions): Promise<string>;

  /**
   * Confirm upload completed (verify file exists)
   */
  confirmUpload(key: string): Promise<FileMetadata>;
}

export interface UploadUrlOptions {
  /**
   * Original filename (used to generate key)
   */
  filename: string;

  /**
   * Content type (MIME type)
   */
  contentType: string;

  /**
   * Maximum file size in bytes (optional, for validation)
   */
  maxSize?: number;

  /**
   * Custom metadata to attach to object
   */
  metadata?: Record<string, string>;

  /**
   * Custom key (overrides auto-generated key)
   */
  customKey?: string;

  /**
   * URL expiration in seconds
   */
  expiresIn?: number;
}

export interface PresignedUploadResult {
  /**
   * Presigned URL for upload
   */
  uploadUrl: string;

  /**
   * S3 key for the object
   */
  key: string;

  /**
   * HTTP method to use (PUT)
   */
  method: 'PUT';

  /**
   * Headers to include in upload request
   */
  headers: Record<string, string>;

  /**
   * URL expiration timestamp
   */
  expiresAt: Date;
}

export interface FileMetadata {
  key: string;
  size: number;
  contentType?: string;
  lastModified?: Date;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface FileListResult {
  files: FileMetadata[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

export interface DirectUploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  acl?: 'private' | 'public-read';
}

// ============================================
// S3 Storage Adapter Implementation
// ============================================

/**
 * Create S3 storage adapter
 */
export function s3StorageAdapter(options: S3StorageOptions): StorageAdapter {
  const {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    endpoint,
    forcePathStyle,
    presignedUrlExpiry = 3600,
    downloadUrlExpiry = 86400,
    keyPrefix = '',
    publicUrlBase,
    acl,
    serverSideEncryption,
    kmsKeyId,
  } = options;

  // Create S3 client
  const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
    region,
    forcePathStyle,
  };

  if (endpoint) {
    clientConfig.endpoint = endpoint;
  }

  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId,
      secretAccessKey,
    };
  }

  const client = new S3Client(clientConfig);

  /**
   * Generate unique key for file
   */
  function generateKey(filename: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const sanitizedName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `${keyPrefix}${timestamp}-${random}-${sanitizedName}`;
  }

  /**
   * Get full key with prefix
   */
  function getFullKey(key: string): string {
    if (key.startsWith(keyPrefix)) {
      return key;
    }
    return `${keyPrefix}${key}`;
  }

  return {
    async getUploadUrl(uploadOptions: UploadUrlOptions): Promise<PresignedUploadResult> {
      const key = uploadOptions.customKey || generateKey(uploadOptions.filename);
      const fullKey = getFullKey(key);
      const expiresIn = uploadOptions.expiresIn || presignedUrlExpiry;

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: fullKey,
        ContentType: uploadOptions.contentType,
        ...(acl && { ACL: acl }),
        ...(serverSideEncryption && { ServerSideEncryption: serverSideEncryption }),
        ...(kmsKeyId && { SSEKMSKeyId: kmsKeyId }),
        ...(uploadOptions.metadata && { Metadata: uploadOptions.metadata }),
      });

      const uploadUrl = await getSignedUrl(client, command, { expiresIn });

      const headers: Record<string, string> = {
        'Content-Type': uploadOptions.contentType,
      };

      if (uploadOptions.metadata) {
        for (const [key, value] of Object.entries(uploadOptions.metadata)) {
          headers[`x-amz-meta-${key}`] = value;
        }
      }

      return {
        uploadUrl,
        key: fullKey,
        method: 'PUT',
        headers,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      };
    },

    async getDownloadUrl(key: string, expiresIn?: number): Promise<string> {
      const fullKey = getFullKey(key);

      // If public URL base is configured, return public URL
      if (publicUrlBase) {
        return `${publicUrlBase}/${fullKey}`;
      }

      // Otherwise, generate presigned URL
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: fullKey,
      });

      return getSignedUrl(client, command, {
        expiresIn: expiresIn || downloadUrlExpiry,
      });
    },

    async delete(key: string): Promise<void> {
      const fullKey = getFullKey(key);

      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: fullKey,
        })
      );
    },

    async exists(key: string): Promise<boolean> {
      const fullKey = getFullKey(key);

      try {
        await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: fullKey,
          })
        );
        return true;
      } catch (error: any) {
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
          return false;
        }
        throw error;
      }
    },

    async getMetadata(key: string): Promise<FileMetadata | null> {
      const fullKey = getFullKey(key);

      try {
        const response = await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: fullKey,
          })
        );

        return {
          key: fullKey,
          size: response.ContentLength || 0,
          contentType: response.ContentType,
          lastModified: response.LastModified,
          etag: response.ETag,
          metadata: response.Metadata,
        };
      } catch (error: any) {
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
          return null;
        }
        throw error;
      }
    },

    async list(prefix?: string, maxKeys: number = 1000): Promise<FileListResult> {
      const fullPrefix = prefix ? getFullKey(prefix) : keyPrefix;

      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: fullPrefix,
          MaxKeys: maxKeys,
        })
      );

      const files: FileMetadata[] = (response.Contents || []).map((obj) => ({
        key: obj.Key || '',
        size: obj.Size || 0,
        lastModified: obj.LastModified,
        etag: obj.ETag,
      }));

      return {
        files,
        isTruncated: response.IsTruncated || false,
        nextContinuationToken: response.NextContinuationToken,
      };
    },

    async copy(sourceKey: string, destinationKey: string): Promise<void> {
      const fullSourceKey = getFullKey(sourceKey);
      const fullDestKey = getFullKey(destinationKey);

      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${fullSourceKey}`,
          Key: fullDestKey,
          ...(acl && { ACL: acl }),
          ...(serverSideEncryption && { ServerSideEncryption: serverSideEncryption }),
        })
      );
    },

    async upload(
      key: string,
      data: Buffer | Uint8Array,
      uploadOptions?: DirectUploadOptions
    ): Promise<string> {
      const fullKey = getFullKey(key);

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: fullKey,
          Body: data,
          ContentType: uploadOptions?.contentType,
          ...(uploadOptions?.acl && { ACL: uploadOptions.acl }),
          ...(uploadOptions?.metadata && { Metadata: uploadOptions.metadata }),
          ...(serverSideEncryption && { ServerSideEncryption: serverSideEncryption }),
          ...(kmsKeyId && { SSEKMSKeyId: kmsKeyId }),
        })
      );

      return fullKey;
    },

    async confirmUpload(key: string): Promise<FileMetadata> {
      const metadata = await this.getMetadata(key);

      if (!metadata) {
        throw new Error(`File not found: ${key}`);
      }

      return metadata;
    },
  };
}

/**
 * Create S3 adapter from environment variables
 *
 * Expects:
 * - S3_BUCKET
 * - S3_REGION (or AWS_REGION)
 * - AWS_ACCESS_KEY_ID (optional)
 * - AWS_SECRET_ACCESS_KEY (optional)
 * - S3_ENDPOINT (optional, for S3-compatible services)
 */
export function s3StorageAdapterFromEnv(
  options?: Partial<S3StorageOptions>
): StorageAdapter {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('S3_BUCKET environment variable is required');
  }

  const region = process.env.S3_REGION || process.env.AWS_REGION;
  if (!region) {
    throw new Error('S3_REGION or AWS_REGION environment variable is required');
  }

  return s3StorageAdapter({
    bucket,
    region,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    keyPrefix: process.env.S3_KEY_PREFIX || 'mdm/apks/',
    publicUrlBase: process.env.S3_PUBLIC_URL_BASE,
    ...options,
  });
}

// ============================================
// APK-specific utilities
// ============================================

export interface APKUploadOptions {
  /**
   * Package name (e.g., com.example.app)
   */
  packageName: string;

  /**
   * Version string (e.g., 1.0.0)
   */
  version: string;

  /**
   * Version code (integer)
   */
  versionCode: number;

  /**
   * Optional release notes
   */
  releaseNotes?: string;
}

/**
 * Generate S3 key for APK file
 */
export function generateAPKKey(options: APKUploadOptions): string {
  const { packageName, version, versionCode } = options;
  const timestamp = Date.now();
  return `apks/${packageName}/${versionCode}-${version}-${timestamp}.apk`;
}

/**
 * Get presigned URL specifically for APK upload
 */
export async function getAPKUploadUrl(
  storage: StorageAdapter,
  options: APKUploadOptions & { expiresIn?: number }
): Promise<PresignedUploadResult> {
  const key = generateAPKKey(options);

  return storage.getUploadUrl({
    filename: `${options.packageName}-${options.version}.apk`,
    contentType: 'application/vnd.android.package-archive',
    customKey: key,
    expiresIn: options.expiresIn,
    metadata: {
      'package-name': options.packageName,
      'version': options.version,
      'version-code': options.versionCode.toString(),
      ...(options.releaseNotes && { 'release-notes': options.releaseNotes }),
    },
  });
}

// ============================================
// Exports
// ============================================

export type { S3Client };
