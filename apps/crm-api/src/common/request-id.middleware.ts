import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { requestContext } from "./request-context";

/**
 * Pass through an inbound `x-request-id` or mint one, echo it on the response, and run the
 * rest of the request inside the async-local context so logs can correlate by id.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers["x-request-id"];
  const incoming = Array.isArray(header) ? header[0] : header;
  const requestId = incoming?.trim() ? incoming.trim() : randomUUID();

  res.setHeader("x-request-id", requestId);
  requestContext.run({ requestId }, () => {
    next();
  });
}
