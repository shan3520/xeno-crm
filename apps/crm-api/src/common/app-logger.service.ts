import { Injectable, LoggerService } from "@nestjs/common";

import { getRequestId } from "./request-context";

type LogLevel = "log" | "error" | "warn" | "debug" | "verbose";

/**
 * Structured JSON logger. Every line carries the current requestId (when inside a request),
 * a level, an optional context, and the message — easy to grep/ship.
 */
@Injectable()
export class AppLogger implements LoggerService {
  private write(
    level: LogLevel,
    message: unknown,
    context?: string,
    extra?: Record<string, unknown>,
  ): void {
    const line = {
      timestamp: new Date().toISOString(),
      level,
      requestId: getRequestId(),
      context: context ?? null,
      message,
      ...extra,
    };
    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(`${JSON.stringify(line)}\n`);
  }

  log(message: unknown, context?: string): void {
    this.write("log", message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.write("error", message, context, stack ? { stack } : undefined);
  }

  warn(message: unknown, context?: string): void {
    this.write("warn", message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write("debug", message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write("verbose", message, context);
  }
}
