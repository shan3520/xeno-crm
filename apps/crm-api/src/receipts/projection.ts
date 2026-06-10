import type { CommEventType, CommStatus } from "@xeno/shared";

/**
 * Pure status projection for a Communication. Status is NOT assigned from arrival order —
 * it is recomputed from the comm's full event set every time, by type-precedence on
 * occurredAt. No DB, no framework — unit-tested in isolation.
 *
 * Precedence ladder (ascending): SENT < DELIVERED < OPENED < READ < CLICKED. status is the
 * highest ladder rung the comm has ANY event for. So a late-arriving DELIVERED after a
 * CLICKED never downgrades status (CLICKED outranks it).
 *
 * FAILED is TERMINAL and dominates: if a FAILED event exists, status = FAILED regardless of
 * any ladder events present. (The stub stops its chain on FAILED so they shouldn't coexist;
 * we make the rule explicit — a failed send cannot have been genuinely delivered/engaged, so
 * FAILED wins.)
 *
 * CONVERTED is a side-flag, not a ladder rung: it never changes status; it only stamps
 * convertedAt. A converted comm's status reflects its furthest engagement (typically CLICKED).
 */

const LADDER: Record<string, number> = {
  SENT: 1,
  DELIVERED: 2,
  OPENED: 3,
  READ: 4,
  CLICKED: 5,
};

export interface ProjectionEvent {
  type: CommEventType;
  occurredAt: Date;
}

export interface CommunicationProjection {
  status: CommStatus;
  sentAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  readAt: Date | null;
  clickedAt: Date | null;
  failedAt: Date | null;
  convertedAt: Date | null;
}

/**
 * Project a Communication's status + per-state timestamps from its event set. Each *At is
 * the EARLIEST occurredAt of that event type (duplicates collapse to the same instant), so
 * the result is fully order- and duplicate-independent.
 */
export function projectCommunication(events: ProjectionEvent[]): CommunicationProjection {
  const earliest = new Map<string, Date>();
  for (const event of events) {
    const current = earliest.get(event.type);
    if (current === undefined || event.occurredAt < current) {
      earliest.set(event.type, event.occurredAt);
    }
  }

  const at = (type: string): Date | null => earliest.get(type) ?? null;

  let status: CommStatus;
  if (earliest.has("FAILED")) {
    status = "FAILED";
  } else {
    let bestRung = 0;
    let bestType: CommStatus = "SENT"; // a comm being projected has at least been sent
    for (const [type, rung] of Object.entries(LADDER)) {
      if (earliest.has(type) && rung > bestRung) {
        bestRung = rung;
        bestType = type as CommStatus;
      }
    }
    status = bestType;
  }

  return {
    status,
    sentAt: at("SENT"),
    deliveredAt: at("DELIVERED"),
    openedAt: at("OPENED"),
    readAt: at("READ"),
    clickedAt: at("CLICKED"),
    failedAt: at("FAILED"),
    convertedAt: at("CONVERTED"),
  };
}
