/// <reference types="vitest/globals" />
import { createHmac } from "node:crypto";

import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";

import type { AppConfigService } from "../config/app-config.service";
import { ReceiptSignatureGuard } from "./receipt-signature.guard";

const SECRET = "shared-secret-123";
const RAW = Buffer.from(
  JSON.stringify({ communicationId: "c1", type: "DELIVERED", idempotencyKey: "c1:p1:DELIVERED" }),
);

const sign = (body: Buffer, secret: string): string =>
  createHmac("sha256", secret).update(body).digest("hex");

/** Guard wired with a stub config exposing only the secret it reads. */
function guardWith(secret: string): ReceiptSignatureGuard {
  return new ReceiptSignatureGuard({ callbackHmacSecret: secret } as unknown as AppConfigService);
}

/** Minimal ExecutionContext that yields a request with the given headers + rawBody. */
function ctxWith(headers: Record<string, unknown>, rawBody: Buffer | undefined): ExecutionContext {
  const req = { headers, rawBody };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe("ReceiptSignatureGuard", () => {
  it("allows any request when no secret is configured (verification disabled)", () => {
    // Backward-compatible default: empty secret => no header required, request passes.
    expect(guardWith("").canActivate(ctxWith({}, undefined))).toBe(true);
  });

  it("accepts a request whose signature matches the body + secret", () => {
    const ctx = ctxWith({ "x-signature": sign(RAW, SECRET) }, RAW);
    expect(guardWith(SECRET).canActivate(ctx)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const ctx = ctxWith({ "x-signature": sign(RAW, "wrong-secret") }, RAW);
    expect(() => guardWith(SECRET).canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects a request missing the signature header", () => {
    expect(() => guardWith(SECRET).canActivate(ctxWith({}, RAW))).toThrow(UnauthorizedException);
  });

  it("rejects a request with no raw body to verify", () => {
    const ctx = ctxWith({ "x-signature": sign(RAW, SECRET) }, undefined);
    expect(() => guardWith(SECRET).canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects a tampered body even with an otherwise-valid-looking signature", () => {
    // A forged body (e.g. an injected CONVERTED with fake revenue) won't match the signature.
    const tampered = Buffer.from(JSON.stringify({ communicationId: "c1", type: "CONVERTED" }));
    const ctx = ctxWith({ "x-signature": sign(RAW, SECRET) }, tampered);
    expect(() => guardWith(SECRET).canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
