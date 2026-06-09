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
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body: ErrorResponse = {
      statusCode: status,
      error: STATUS_CODES[status] ?? "Error",
      message: this.extractMessage(exception),
      requestId: getRequestId(),
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${status} ${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
        "Exception",
      );
    } else {
      this.logger.warn(`${status} ${body.message}`, "Exception");
    }

    res.status(status).json(body);
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
