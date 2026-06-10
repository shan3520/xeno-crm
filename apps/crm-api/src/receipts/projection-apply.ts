import { Prisma } from "@prisma/client";
import type { CommStatus } from "@xeno/shared";

import type { CommunicationProjection } from "./projection";

/**
 * Shared, pure mappers between a projected status and the materialized Communication row.
 * Single source of truth for BOTH the live receipt handler and the reconciliation sweep, so
 * the two paths can never drift in how they write status/timestamps.
 *
 * projection.ts (the pure projector) is unchanged — this only maps its result onto a Prisma
 * update payload and gives us a precedence rank for "is this row behind its events?" checks.
 */

/**
 * Precedence rank of a stored/projected status. Mirrors projection.ts: SENT < DELIVERED <
 * OPENED < READ < CLICKED, with FAILED terminal-dominant (above the ladder) and QUEUED below
 * SENT. Used to decide whether a re-projection would ADVANCE a comm (heal) — never to
 * downgrade it. Kept in lockstep with projection.ts's LADDER; FAILED dominates there too.
 */
export const STATUS_RANK: Record<CommStatus, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  OPENED: 3,
  READ: 4,
  CLICKED: 5,
  FAILED: 100,
};

/** True when `projected` outranks `stored` — i.e. the event set implies a later status. */
export function isBehind(stored: CommStatus, projected: CommStatus): boolean {
  return STATUS_RANK[projected] > STATUS_RANK[stored];
}

/**
 * Build the Communication update from a projection. status is always set; each *At is only
 * written when present, so we never clobber an existing timestamp with null. failureReason is
 * applied only for a FAILED projection (caller supplies the reason; a default backstops it).
 */
export function projectionToCommunicationUpdate(
  p: CommunicationProjection,
  opts: { failureReason?: string } = {},
): Prisma.CommunicationUpdateInput {
  const data: Prisma.CommunicationUpdateInput = { status: p.status };
  if (p.sentAt) data.sentAt = p.sentAt;
  if (p.deliveredAt) data.deliveredAt = p.deliveredAt;
  if (p.openedAt) data.openedAt = p.openedAt;
  if (p.readAt) data.readAt = p.readAt;
  if (p.clickedAt) data.clickedAt = p.clickedAt;
  if (p.failedAt) data.failedAt = p.failedAt;
  if (p.convertedAt) data.convertedAt = p.convertedAt;
  if (p.status === "FAILED") {
    data.failureReason = opts.failureReason ?? "channel reported delivery failure";
  }
  return data;
}
