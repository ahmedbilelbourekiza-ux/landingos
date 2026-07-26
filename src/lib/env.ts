import { z } from "zod";

// Centralized, validated environment access. Import `env` instead of reading
// process.env directly so missing/invalid config fails fast at startup with a
// clear message rather than silently breaking at runtime.
//
// Reserved keys for upcoming tasks (declared optional so the app still boots
// before those features are built):
//   - CRM_WEBHOOK_URL  -> outbound webhook target for form submissions
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  CRM_WEBHOOK_URL: z.string().url().optional(),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment variables — ${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
