import Fastify from "fastify";
import { SHARED_OK } from "@xeno/shared";

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
    app.log.info(`channel-stub listening on :${port} (shared ok: ${SHARED_OK})`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
