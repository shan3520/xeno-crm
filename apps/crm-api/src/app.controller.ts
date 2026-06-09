import { Controller, Get } from "@nestjs/common";

interface HealthResponse {
  status: "ok";
  service: "crm-api";
}

@Controller("health")
export class AppController {
  @Get()
  health(): HealthResponse {
    return { status: "ok", service: "crm-api" };
  }
}
