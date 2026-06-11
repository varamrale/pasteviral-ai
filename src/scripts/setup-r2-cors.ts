import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3'

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT ?? '',
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ?? '',
  },
})

const appOrigin = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const bucket = process.env.CLOUDFLARE_R2_BUCKET ?? ''

async function main() {
  if (!bucket) {
    console.error('CLOUDFLARE_R2_BUCKET env var is required')
    process.exit(1)
  }

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [appOrigin],
            AllowedMethods: ['GET', 'HEAD'],
            AllowedHeaders: ['*'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  )

  console.log(`R2 CORS configured for bucket "${bucket}" — origin: ${appOrigin}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
