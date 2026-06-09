import { z } from "zod";

/**
 * Environment contract for crm-api. Required keys fail boot fast with a clear message.
 * Numeric worker knobs are coerced from strings; URLs are shape-checked.
 */
export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CHANNEL_STUB_URL: z.string().url(),
  PUBLIC_BASE_URL: z.string().url(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive(),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive(),
  SEND_RATE_PER_SEC: z.coerce.number().int().positive(),
  // CORS origin for the web app; defaulted so local dev works out of the box.
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Validate raw env (called by @nestjs/config at boot). Throws a readable, multi-line
 * error listing every offending key so a missing DATABASE_URL is obvious.
 */
export function validateEnv(raw: Record<string, unknown>): AppConfig {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n` +
        `Check apps/crm-api/.env against apps/crm-api/.env.example.`,
    );
  }
  return parsed.data;
}
