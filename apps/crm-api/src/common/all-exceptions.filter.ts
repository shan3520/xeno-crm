import { STATUS_CODES } from "node:http";

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";

import { AppLogger } from "./app-logger.service";
import { getRequestId } from "./request-context";

/** Consistent error envelope returned for every thrown exception. */
interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  requestId: string | null;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = this.resolveStatus(exception);
    const isServerError = status >= HttpStatus.INTERNAL_SERVER_ERROR;

    // Never leak internal error detail (Prisma/DB messages, stack frames) on a 5xx — those
    // are logged server-side below but returned to the client as a generic message. Client
    // (4xx) errors keep their specific, safe message.
    const body: ErrorResponse = {
      statusCode: status,
      error: STATUS_CODES[status] ?? "Error",
      message: isServerError ? "Internal server error" : this.extractMessage(exception),
      requestId: getRequestId(),
    };

    if (isServerError) {
      this.logger.error(
        `${status} ${this.extractMessage(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
        "Exception",
      );
    } else {
      this.logger.warn(`${status} ${body.message}`, "Exception");
    }

    res.status(status).json(body);
  }

  /**
   * Resolve the HTTP status. HttpExceptions carry their own; other libraries (e.g. the
   * body-parser PayloadTooLarge → 413) throw plain Errors that carry a numeric `status`/
   * `statusCode` — honor those so they don't all collapse to 500. Everything else is a 500.
   */
  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    const carried =
      (exception as { status?: unknown; statusCode?: unknown } | null)?.status ??
      (exception as { statusCode?: unknown } | null)?.statusCode;
    if (typeof carried === "number" && carried >= 400 && carried < 600) {
      return carried;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private extractMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === "string") {
        return response;
      }
      if (response !== null && typeof response === "object") {
        const record = response as Record<string, unknown>;
        const message = record["message"];
        if (typeof message === "string") {
          return message;
        }
        if (Array.isArray(message)) {
          return message.map((m) => String(m)).join("; ");
        }
        // nestjs-zod validation errors carry zod issues under `errors`.
        const errors = record["errors"];
        if (errors !== undefined) {
          return `Validation failed: ${JSON.stringify(errors)}`;
        }
      }
      return exception.message;
    }
    if (exception instanceof Error) {
      return exception.message;
    }
    return "Internal server error";
  }
}
