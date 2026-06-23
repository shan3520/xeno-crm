import { createHmac, timingSafeEqual } from "node:crypto";

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  RawBodyRequest,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";

import { AppConfigService } from "../config/app-config.service";

const SIGNATURE_HEADER = "x-signature";

/**
 * Authenticates channel-stub → /receipts callbacks by verifying an HMAC-SHA256 signature over the
 * EXACT request bytes (req.rawBody, enabled via `rawBody: true` in main.ts), keyed by a shared
 * secret. Without it, anyone who guesses a communicationId could forge lifecycle/CONVERTED events
 * and poison stats/revenue.
 *
 * Gated for safe rollout: when CALLBACK_HMAC_SECRET is empty (the default), verification is OFF and
 * every request passes — fully backward compatible. Set the SAME secret on BOTH this service and
 * the channel-stub (its CALLBACK_HMAC_SECRET) to require signed, verified receipts.
 */
@Injectable()
export class ReceiptSignatureGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.callbackHmacSecret;
    if (!secret) return true; // verification disabled until a shared secret is configured

    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const provided = req.headers[SIGNATURE_HEADER];
    const raw = req.rawBody;
    if (typeof provided !== "string" || !raw) {
      throw new UnauthorizedException("Missing receipt signature");
    }

    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    // Length check first: timingSafeEqual throws on unequal lengths.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("Invalid receipt signature");
    }
    return true;
  }
}
