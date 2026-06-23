import type { ReceiptEvent } from "@xeno/shared";

// Retry budget is sized to outlast a CRM cold start. The CRM runs on a free dyno that can be
// asleep (~17–40s to wake) exactly when a callback fires; a short ~1.4s budget would exhaust all
// retries while it boots and DROP the receipt — and a dropped DELIVERED later gets reconciled to
// FAILED, under-reporting a genuinely-delivered comm. With capped exponential backoff the total
// window spans ~30s (250,500,1000,2000,4000,8000,8000,8000ms), covering a typical wake.
const MAX_RETRIES = 8;
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 8000;

/**
 * POST a ReceiptEvent to the CRM's receipt endpoint.
 *
 * Retries up to MAX_RETRIES times with capped exponential backoff on failure
 * (non-2xx response or network error). On final failure, logs a warning
 * and silently drops — the stub must never crash or block other sends
 * because the CRM is temporarily unreachable.
 */
export async function postReceipt(
  url: string,
  event: ReceiptEvent,
  logger: { warn: (msg: string) => void; error: (msg: string) => void },
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });

      if (response.ok) {
        return; // Success — done
      }

      // Non-2xx: log and maybe retry
      const body = await response.text().catch(() => "(unreadable body)");
      logger.warn(
        `callback ${event.type} for ${event.communicationId} ` +
          `returned ${response.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${body}`,
      );
    } catch (err: unknown) {
      // Network error (connection refused, DNS failure, etc.)
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        `callback ${event.type} for ${event.communicationId} ` +
          `failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${message}`,
      );
    }

    // Wait before retrying (skip wait on final attempt)
    if (attempt < MAX_RETRIES) {
      const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
      await sleep(backoff);
    }
  }

  // All retries exhausted — drop the event
  logger.error(
    `callback ${event.type} for ${event.communicationId} ` +
      `permanently failed after ${MAX_RETRIES + 1} attempts — dropping`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
