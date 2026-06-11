import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const SIGNED_URL_EXPIRY = 48 * 60 * 60
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

function createClient(): S3Client {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? ''
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY ?? '',
      secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY ?? '',
    },
  })
}

function bucket(): string {
  return process.env.CLOUDFLARE_R2_BUCKET ?? 'pasteviral-reels'
}

export function getPublicUrl(key: string): string {
  const base = (process.env.CLOUDFLARE_R2_PUBLIC_URL ?? '').replace(/\/$/, '')
  return `${base}/${key}`
}

export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<string> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Upload rejected: ${buffer.byteLength} bytes exceeds ${MAX_UPLOAD_BYTES} byte limit`,
    )
  }
  const client = createClient()
  await client.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  )
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: SIGNED_URL_EXPIRY },
  )
  return url
}

export async function deleteFromR2(key: string): Promise<void> {
  const client = createClient()
  await client.send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: key }),
  )
}
