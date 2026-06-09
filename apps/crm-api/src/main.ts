import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SHARED_OK } from "@xeno/shared";

import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  Logger.log(
    `crm-api listening on http://localhost:${port} (shared ok: ${SHARED_OK})`,
    "Bootstrap",
  );
}

void bootstrap();
