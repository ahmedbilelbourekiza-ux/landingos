import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

// Cloudflare R2 storage for uploaded images.
//
// R2 speaks the S3 API, so the standard AWS SDK client works against it — the
// only differences are the endpoint (built from the account id) and the fixed
// "auto" region.
//
// Why R2 rather than the local filesystem: Render's free tier has an
// ephemeral filesystem. The container is wiped on every deploy AND whenever
// the free instance spins down after inactivity, so locally-stored uploads
// disappear within hours. R2 keeps them permanently and has free egress.
//
// R2 is OPTIONAL. If the environment variables below are not set, the app
// transparently falls back to local disk (see src/lib/uploads.ts), so local
// development and self-hosted deployments work with no cloud account.
//
// Required to enable R2:
//   R2_ACCOUNT_ID         — from the Cloudflare dashboard URL / R2 overview
//   R2_ACCESS_KEY_ID      — from an R2 API token
//   R2_SECRET_ACCESS_KEY  — from the same R2 API token
//   R2_BUCKET             — the bucket name
//
// Optional:
//   R2_PUBLIC_BASE_URL    — a public bucket URL or custom domain, e.g.
//                           https://pub-xxxx.r2.dev or https://img.example.com
//                           When set, image requests are redirected straight
//                           to Cloudflare's CDN instead of being streamed
//                           through this server, which removes image traffic
//                           from the app's bandwidth entirely. Leave it unset
//                           to keep the bucket private and proxy through the
//                           app instead — both work.

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string | null;
}

export function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || null;

  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

export function isR2Configured(): boolean {
  return getR2Config() !== null;
}

// The SDK client is cached per process — creating one per request would
// re-resolve credentials and re-open connections on every upload.
let cachedClient: S3Client | null = null;
let cachedForAccount: string | null = null;

function getClient(config: R2Config): S3Client {
  if (cachedClient && cachedForAccount === config.accountId) return cachedClient;

  cachedClient = new S3Client({
    region: "auto", // R2 ignores region, but the SDK requires one
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedForAccount = config.accountId;
  return cachedClient;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const config = getR2Config();
  if (!config) throw new Error("R2 is not configured");

  await getClient(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Filenames are UUIDs and content never changes for a given key, so
      // this is safe to cache permanently. Applies when the object is served
      // directly from a public bucket / custom domain.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

export interface R2Object {
  body: Buffer;
  contentType: string | null;
}

// Returns null when the object does not exist, so callers can fall through to
// a local-disk lookup (covers images uploaded before R2 was switched on).
export async function getObject(key: string): Promise<R2Object | null> {
  const config = getR2Config();
  if (!config) return null;

  try {
    const res = await getClient(config).send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    if (!res.Body) return null;

    const bytes = await res.Body.transformToByteArray();
    return { body: Buffer.from(bytes), contentType: res.ContentType ?? null };
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    console.error(`[r2] failed to read "${key}":`, error);
    return null;
  }
}

// Public CDN URL for a key, when a public bucket / custom domain is set up.
export function getPublicUrl(key: string): string | null {
  const config = getR2Config();
  if (!config?.publicBaseUrl) return null;
  return `${config.publicBaseUrl}/${key}`;
}
