import { Controller, Get } from "@nestjs/common";

interface HealthResponse {
  status: "ok";
  service: "crm-api";
}

@Controller()
export class AppController {
  @Get("health")
  health(): HealthResponse {
    return { status: "ok", service: "crm-api" };
  }
}
