import { randomUUID } from "node:crypto";

import type { Channel, CommEventType, ReceiptEvent } from "@xeno/shared";

import { postReceipt } from "./callback";
import type { Config } from "./config";

interface LifecycleParams {
  communicationId: string;
  providerMessageId: string;
  channel: Channel;
  config: Config;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

/**
 * Schedule the full lifecycle event chain for a single communication.
 *
 * This function returns immediately — all events are scheduled on
 * independent in-memory timers (`setTimeout`). Because each timer's
 * delay is drawn independently from [MIN_DELAY_MS, MAX_DELAY_MS],
 * the CRM may receive events in a different order than their causal
 * `occurredAt` timestamps, exercising arrival-order-independent
 * status projection.
 *
 * TRADEOFF: In-memory timers are lost if the process restarts.
 * This is an accepted, documented limitation — the stub is not a
 * durable queue, it is a simulation aid.
 */
export function scheduleLifecycle(params: LifecycleParams): void {
  const { communicationId, providerMessageId, channel, config, logger } = params;
  const sendTime = Date.now();

  // 1. Determine which events occur (probabilistic, channel-aware)
  const chain = buildEventChain(channel, config);

  logger.info(
    `scheduling lifecycle for ${communicationId}: ` +
      `${chain.join(" → ")} (channel=${channel})`,
  );

  // 2. Schedule each event on an independent timer
  let simulatedTime = sendTime;

  for (let i = 0; i < chain.length; i++) {
    const eventType = chain[i]!;

    // Advance simulated channel time (causally ordered)
    const simulatedInterval = randomBetween(config.minDelayMs, config.maxDelayMs);
    simulatedTime += simulatedInterval;
    const occurredAt = new Date(simulatedTime).toISOString();

    // Stable idempotency key: same for retries and deliberate duplicates
    const idempotencyKey = `${communicationId}:${providerMessageId}:${eventType}`;

    const payload: Record<string, unknown> =
      eventType === "CONVERTED" ? buildConversionPayload() : {};

    const receipt: ReceiptEvent = {
      communicationId,
      providerMessageId,
      type: eventType,
      occurredAt,
      idempotencyKey,
      payload,
    };

    // Independent fire delay — uncorrelated with causal position,
    // producing genuine out-of-order arrivals at the CRM
    const fireDelay = randomBetween(config.minDelayMs, config.maxDelayMs);

    schedulePost(config.crmReceiptUrl, receipt, fireDelay, logger);

    // Chaos: with probability DUPLICATE_PCT, send the exact same event
    // again (same idempotencyKey) so the CRM's dedup logic is exercised
    if (Math.random() < config.duplicatePct) {
      const dupeDelay = fireDelay + randomBetween(100, 2_000);
      schedulePost(config.crmReceiptUrl, receipt, dupeDelay, logger);
      logger.info(`duplicate scheduled for ${eventType} of ${communicationId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Build the probabilistic event chain for a given channel.
 *
 * Chain: SENT → DELIVERED|FAILED → OPENED → READ → CLICKED → CONVERTED
 *
 * - SMS skips OPENED/READ (no open-tracking pixel); CLICKED follows DELIVERED.
 * - EMAIL/WHATSAPP/RCS run the full chain.
 * - Each transition is gated by its probability; the chain terminates on FAILED
 *   or when a probability check fails.
 */
function buildEventChain(channel: Channel, config: Config): CommEventType[] {
  const events: CommEventType[] = ["SENT"];

  // DELIVERED vs FAILED
  if (Math.random() >= config.deliveredRate) {
    events.push("FAILED");
    return events; // Chain stops on failure
  }
  events.push("DELIVERED");

  const supportsOpenTracking = channel !== "SMS";

  if (supportsOpenTracking) {
    // OPENED
    if (Math.random() >= config.openRate) {
      return events; // Not opened — chain stops
    }
    events.push("OPENED");

    // READ (0.7 probability of opened messages)
    if (Math.random() < 0.7) {
      events.push("READ");
    } else {
      return events; // Opened but not read — no further engagement
    }
  }

  // CLICKED (follows READ for open-tracking channels, DELIVERED for SMS)
  if (Math.random() >= config.clickRate) {
    return events;
  }
  events.push("CLICKED");

  // CONVERTED
  if (Math.random() >= config.convertRate) {
    return events;
  }
  events.push("CONVERTED");

  return events;
}

/**
 * Generate a synthetic conversion payload the CRM can attribute.
 */
function buildConversionPayload(): Record<string, unknown> {
  return {
    externalId: `ord_${randomUUID().slice(0, 8)}`,
    amount: +(Math.random() * 500 + 10).toFixed(2),
    currency: "USD",
    orderedAt: new Date().toISOString(),
  };
}

/**
 * Schedule a single receipt POST on a timer.
 * The callback is fire-and-forget — errors are handled inside postReceipt.
 */
function schedulePost(
  url: string,
  receipt: ReceiptEvent,
  delayMs: number,
  logger: { warn: (msg: string) => void; error: (msg: string) => void },
): void {
  setTimeout(() => {
    void postReceipt(url, receipt, logger);
  }, delayMs);
}

/** Uniform random integer in [min, max]. */
function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
