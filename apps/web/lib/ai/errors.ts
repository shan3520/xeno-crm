import { APICallError } from "ai";

/**
 * Typed degradation for Gemini failures. The AI SDK already retries retryable errors (429 /
 * RESOURCE_EXHAUSTED) with exponential backoff up to `maxRetries`; once those are exhausted it
 * THROWS. Tools catch that and map it here to a structured result the UI can render — a
 * rate-limited turn must never throw an unhandled error into the stream.
 */

/** Discriminated failure a tool returns instead of throwing. */
export interface ToolFailure {
  ok: false;
  error: "rate_limited" | "validation_failed" | "failed";
  message: string;
}

/** True for a Gemini 429 / RESOURCE_EXHAUSTED / quota error (after SDK retries are spent). */
export function isRateLimited(err: unknown): boolean {
  if (APICallError.isInstance(err)) {
    if (err.statusCode === 429) return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(message);
}

/** Map any thrown error to a typed ToolFailure (rate-limit degrades to a retry surface). */
export function toToolFailure(err: unknown): ToolFailure {
  if (isRateLimited(err)) {
    return {
      ok: false,
      error: "rate_limited",
      message: "The model is rate-limited right now. Please retry in a moment.",
    };
  }
  return {
    ok: false,
    error: "failed",
    message: err instanceof Error ? err.message : String(err),
  };
}
