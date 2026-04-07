import { S3Client, PutObjectCommand, PutObjectTaggingCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface UploadUrlResult {
  url: string;
  key: string;
  expiresAt: string;
}

export function getS3Config(): S3Config | null {
  const endpoint = process.env.SPACEHARBOR_S3_ENDPOINT;
  const region = process.env.SPACEHARBOR_S3_REGION;
  const bucket = process.env.SPACEHARBOR_S3_BUCKET;
  const accessKeyId = process.env.SPACEHARBOR_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SPACEHARBOR_S3_SECRET_ACCESS_KEY;

  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
}

export async function generateUploadUrl(
  client: S3Client,
  bucket: string,
  key: string,
  contentType: string,
  expiresInSeconds = 3600
): Promise<UploadUrlResult> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  return { url, key, expiresAt };
}


/**
 * Generate a presigned GET URL for downloading/viewing an S3 object.
 * Used by the web UI to preview media files (video, thumbnails) directly from S3.
 */
export async function generateDownloadUrl(
  client: S3Client,
  bucket: string,
  key: string,
  expiresInSeconds = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Apply S3 tags to an existing object.
 * Used at ingest time to write SpaceHarbor metadata tags (ah-project-id, ah-asset-id, etc.)
 * for VAST Catalog integration.
 */
export async function tagS3Object(
  client: S3Client,
  bucket: string,
  key: string,
  tags: Record<string, string>,
): Promise<void> {
  const tagSet = Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));

  const command = new PutObjectTaggingCommand({
    Bucket: bucket,
    Key: key,
    Tagging: { TagSet: tagSet },
  });

  await client.send(command);
}
