import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable, tap } from "rxjs";

import { AppLogger } from "./app-logger.service";

/** Logs the outcome of every HTTP request (method, path, status, duration) with its requestId. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: AppLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const start = Date.now();
    const { method, originalUrl } = req;

    return next.handle().pipe(
      tap({
        next: () =>
          this.logger.log(
            `${method} ${originalUrl} ${res.statusCode} ${Date.now() - start}ms`,
            "HTTP",
          ),
        error: () =>
          this.logger.warn(
            `${method} ${originalUrl} failed ${Date.now() - start}ms`,
            "HTTP",
          ),
      }),
    );
  }
}
