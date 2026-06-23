import { z } from "zod";

/**
 * Environment configuration for the channel stub.
 *
 * Validated once at boot via Zod coercion. All knobs map to env vars
 * documented in `.env.example`; CRM_RECEIPT_URL is the only required
 * variable with no default.
 */

const probability = z.coerce.number().min(0).max(1);

const ConfigSchema = z
  .object({
    port: z.coerce.number().int().positive().default(3002),
    crmReceiptUrl: z.string().url({ message: "CRM_RECEIPT_URL must be a valid URL" }),
    // Optional shared secret: when set (and matching crm-api's CALLBACK_HMAC_SECRET), each receipt
    // POST is signed with an HMAC-SHA256 x-signature header. Empty = unsigned (backward compatible).
    callbackHmacSecret: z.string().default(""),
    deliveredRate: probability.default(0.92),
    openRate: probability.default(0.55),
    clickRate: probability.default(0.3),
    convertRate: probability.default(0.15),
    duplicatePct: probability.default(0.05),
    minDelayMs: z.coerce.number().int().nonnegative().default(500),
    maxDelayMs: z.coerce.number().int().positive().default(30_000),
  })
  .refine((c) => c.maxDelayMs > c.minDelayMs, {
    message: "MAX_DELAY_MS must be greater than MIN_DELAY_MS",
    path: ["maxDelayMs"],
  });

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Parse and validate environment variables into a typed Config.
 * Throws with a descriptive error on validation failure — intended
 * to be called once during server boot so the process exits early.
 */
export function loadConfig(): Config {
  const result = ConfigSchema.safeParse({
    port: process.env["PORT"],
    crmReceiptUrl: process.env["CRM_RECEIPT_URL"],
    callbackHmacSecret: process.env["CALLBACK_HMAC_SECRET"],
    deliveredRate: process.env["DELIVERED_RATE"],
    openRate: process.env["OPEN_RATE"],
    clickRate: process.env["CLICK_RATE"],
    convertRate: process.env["CONVERT_RATE"],
    duplicatePct: process.env["DUPLICATE_PCT"],
    minDelayMs: process.env["MIN_DELAY_MS"],
    maxDelayMs: process.env["MAX_DELAY_MS"],
  });

  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`channel-stub: invalid configuration\n${formatted}`);
  }

  return result.data;
}
