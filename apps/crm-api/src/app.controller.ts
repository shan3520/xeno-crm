import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";

interface HealthResponse {
  status: "ok";
  service: "crm-api";
}

// The keepalive cron pings /health every few seconds — never rate-limit it.
@SkipThrottle()
@Controller()
export class AppController {
  @Get("health")
  health(): HealthResponse {
    return { status: "ok", service: "crm-api" };
  }
}
