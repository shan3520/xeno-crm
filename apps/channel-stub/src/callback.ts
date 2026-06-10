import type { ReceiptEvent } from "@xeno/shared";

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 200;

/**
 * POST a ReceiptEvent to the CRM's receipt endpoint.
 *
 * Retries up to MAX_RETRIES times with exponential backoff on failure
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
      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
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
