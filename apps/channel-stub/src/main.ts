import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import { z } from "zod";
import { ChannelSchema } from "@xeno/shared";

import { loadConfig } from "./config";
import { scheduleLifecycle } from "./lifecycle";

// ---------------------------------------------------------------------------
// Config (validated once at boot — process exits on invalid env)
// ---------------------------------------------------------------------------

const config = loadConfig();

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = Fastify({ logger: true });

// ---- Health ---------------------------------------------------------------

interface HealthResponse {
  status: "ok";
  service: "channel-stub";
}

app.get("/health", async (): Promise<HealthResponse> => {
  return { status: "ok", service: "channel-stub" };
});

// ---- POST /send -----------------------------------------------------------

/**
 * Incoming send request schema. This is the stub's own API contract,
 * not a shared schema — the CRM worker constructs this payload.
 */
const SendRequestSchema = z.object({
  communicationId: z.string().min(1),
  channel: ChannelSchema,
  recipientAddress: z.string().min(1),
  renderedMessage: z.string().min(1),
});

interface SendResponse {
  providerMessageId: string;
}

app.post("/send", async (request, reply): Promise<SendResponse> => {
  const parsed = SendRequestSchema.safeParse(request.body);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return reply.status(400).send({ error: "Invalid request", details: errors });
  }

  const { communicationId, channel } = parsed.data;
  const providerMessageId = randomUUID();

  // Schedule the lifecycle chain — never blocks the response
  scheduleLifecycle({
    communicationId,
    providerMessageId,
    channel,
    config,
    logger: {
      info: (msg) => request.log.info(msg),
      warn: (msg) => request.log.warn(msg),
      error: (msg) => request.log.error(msg),
    },
  });

  return { providerMessageId };
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info(
      `channel-stub listening on :${config.port} ` +
        `(channels: ${ChannelSchema.options.join(", ")})`,
    );
    app.log.info(
      `lifecycle config: delivered=${config.deliveredRate} open=${config.openRate} ` +
        `click=${config.clickRate} convert=${config.convertRate} ` +
        `dupe=${config.duplicatePct} delay=${config.minDelayMs}–${config.maxDelayMs}ms`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
