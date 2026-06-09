import Fastify from "fastify";
import { ChannelSchema } from "@xeno/shared";

interface HealthResponse {
  status: "ok";
  service: "channel-stub";
}

const app = Fastify({ logger: true });

app.get("/health", async (): Promise<HealthResponse> => {
  return { status: "ok", service: "channel-stub" };
});

async function start(): Promise<void> {
  const port = Number(process.env.PORT ?? 3002);
  try {
    await app.listen({ port, host: "0.0.0.0" });
    app.log.info(
      `channel-stub listening on :${port} (channels: ${ChannelSchema.options.join(", ")})`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
