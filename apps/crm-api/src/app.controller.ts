import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { GenerateSegmentRuleInputSchema } from "@xeno/shared";
import { createZodDto } from "nestjs-zod";

interface HealthResponse {
  status: "ok";
  service: "crm-api";
}

// TEMPORARY: DTO derived from an @xeno/shared schema (single source of truth) to prove the
// global Zod validation pipe works. Remove once a real domain module exercises the pipe.
class ProbeDto extends createZodDto(GenerateSegmentRuleInputSchema) {}

@Controller()
export class AppController {
  @Get("health")
  health(): HealthResponse {
    return { status: "ok", service: "crm-api" };
  }

  // TEMPORARY probe endpoint — see ProbeDto note above.
  @Post("_probe")
  @HttpCode(200)
  probe(@Body() dto: ProbeDto): { ok: true; received: ProbeDto } {
    return { ok: true, received: dto };
  }
}
