import type { Prisma } from "@prisma/client";
import type { CommEventType, CommStatus } from "@xeno/shared";

// Reuse the LIVE reference projector + status ranking from the receipts module (read-only
// imports). Using the exact same projection the receipt handler applies is what makes
// invariant #2 a true "stored status == correct status" check rather than a re-derivation
// that could drift.
import { projectCommunication } from "../../../apps/crm-api/src/receipts/projection";
import { STATUS_RANK } from "../../../apps/crm-api/src/receipts/projection-apply";

import type { CampaignRow, CommRow, EventRow } from "./db";

export interface InvariantResult {
  id: number;
  name: string;
  pass: boolean;
  summary: string;
  details: string[];
}

const LADDER_TYPES = [
  "SENT",
  "DELIVERED",
  "OPENED",
  "READ",
  "CLICKED",
  "CONVERTED",
  "FAILED",
] as const;

/** Group events by communicationId for per-comm projection. */
function groupByComm(events: EventRow[]): Map<string, EventRow[]> {
  const map = new Map<string, EventRow[]>();
  for (const e of events) {
    const list = map.get(e.communicationId);
    if (list) list.push(e);
    else map.set(e.communicationId, [e]);
  }
  return map;
}

/**
 * Invariant #1 — ZERO duplicate CommunicationEvents. The stub deliberately re-sends some
 * callbacks (same idempotencyKey); the receipt handler must have deduped them. Two checks:
 * the scoped idempotencyKey set has no collisions, and no comm holds two events of one type.
 */
export function invariantNoDuplicates(events: EventRow[]): InvariantResult {
  const distinctKeys = new Set(events.map((e) => e.idempotencyKey));
  const keyCollisions = events.length - distinctKeys.size;

  const perCommType = new Map<string, number>();
  const dupPairs: string[] = [];
  for (const e of events) {
    const k = `${e.communicationId}|${e.type}`;
    const n = (perCommType.get(k) ?? 0) + 1;
    perCommType.set(k, n);
    if (n === 2) dupPairs.push(k);
  }

  const pass = keyCollisions === 0 && dupPairs.length === 0;
  const details = [
    `events scanned: ${events.length}, distinct idempotencyKeys: ${distinctKeys.size}`,
    `(comm,type) pairs with >1 event: ${dupPairs.length}`,
  ];
  if (dupPairs.length > 0) {
    details.push(`first offenders: ${dupPairs.slice(0, 5).join(", ")}`);
  }
  return {
    id: 1,
    name: "Idempotency — no duplicate events",
    pass,
    summary: pass
      ? `all ${events.length} events unique by idempotencyKey despite duplicate callbacks`
      : `${keyCollisions} key collisions, ${dupPairs.length} duplicated (comm,type) pairs`,
    details,
  };
}

/**
 * Invariant #2 — status never regressed. For every comm, the stored status must equal the
 * projection over its FULL event set. A stored status BEHIND its events is the lost-update
 * bug class that was fixed; a status AHEAD of its events is an unrelated anomaly. Both fail.
 */
export function invariantStatusMonotonic(
  comms: CommRow[],
  events: EventRow[],
): InvariantResult {
  const byComm = groupByComm(events);
  let behind = 0;
  let ahead = 0;
  const samples: string[] = [];

  for (const comm of comms) {
    const evts = byComm.get(comm.id) ?? [];
    const projected: CommStatus =
      evts.length === 0
        ? "QUEUED"
        : projectCommunication(
            evts.map((e) => ({ type: e.type as CommEventType, occurredAt: e.occurredAt })),
          ).status;
    const stored = comm.status as CommStatus;
    if (stored === projected) continue;

    const isBehind = STATUS_RANK[projected] > STATUS_RANK[stored];
    if (isBehind) behind++;
    else ahead++;
    if (samples.length < 8) {
      samples.push(
        `${comm.id}: stored=${stored} ${isBehind ? "BEHIND" : "AHEAD OF"} events→${projected}`,
      );
    }
  }

  const pass = behind === 0 && ahead === 0;
  const details = [
    `communications checked: ${comms.length}`,
    `stored BEHIND events (the lost-update bug class): ${behind}`,
    `stored AHEAD of events (anomaly): ${ahead}`,
  ];
  if (samples.length > 0) details.push(...samples);
  return {
    id: 2,
    name: "Monotonic status — stored == projection(events)",
    pass,
    summary: pass
      ? `every comm's stored status equals projectCommunication(events)`
      : `${behind} behind + ${ahead} ahead of their event sets`,
    details,
  };
}

/**
 * Invariant #3 — projection-cache counters equal the event-log aggregates. Because the stub
 * uses one idempotencyKey per (comm, type), "distinct comms with an X event" equals the count
 * of X events.
 *
 * The CRM maintains two CLASSES of counter, and the reconcile sweep encodes the contract:
 * `recomputeCounters` re-derives the RECEIPT-OWNED funnel counters (delivered/opened/read/
 * clicked/failed/converted) + attributedRevenue from the event log as COUNT(DISTINCT comm) per
 * type, and explicitly LEAVES the WORKER-OWNED columns (queuedCount, sentCount, audienceSize)
 * untouched. So:
 *   • Receipt-owned counters MUST equal the event log — asserted strictly here.
 *   • queuedCount is the launch-time snapshot and must equal the total comms created.
 *   • sentCount counts successful worker markSent transactions, NOT SENT events. It can legitimately
 *     UNDERcount the SENT events when a markSent write fails AFTER the send already happened (the
 *     channel got the send → a SENT event lands → the receipt path advances the comm, but the
 *     worker never recorded the increment). That undercount is a documented best-effort gap, not a
 *     drift; the true invariant is that sentCount must never OVERcount the SENT events (an overcount
 *     would mean double-sending / double-counting). Reported, but only an overcount fails.
 */
export function invariantCountersExact(
  campaign: CampaignRow,
  comms: CommRow[],
  events: EventRow[],
  attributedRevenue: Prisma.Decimal,
): InvariantResult {
  const distinctByType = new Map<string, Set<string>>();
  for (const t of LADDER_TYPES) distinctByType.set(t, new Set());
  for (const e of events) distinctByType.get(e.type)?.add(e.communicationId);
  const distinct = (t: string): number => distinctByType.get(t)?.size ?? 0;

  interface Check {
    label: string;
    cache: number | string;
    derived: number | string;
    ok: boolean;
  }
  // Strict checks — the system contractually guarantees cache == event log for these.
  const strict: Check[] = [];
  const numCheck = (label: string, cache: number, derived: number): void => {
    strict.push({ label, cache, derived, ok: cache === derived });
  };

  numCheck("queued (launch snapshot == total comms)", campaign.queuedCount, comms.length);
  numCheck("delivered", campaign.deliveredCount, distinct("DELIVERED"));
  numCheck("opened", campaign.openedCount, distinct("OPENED"));
  numCheck("read", campaign.readCount, distinct("READ"));
  numCheck("clicked", campaign.clickedCount, distinct("CLICKED"));
  numCheck("failed", campaign.failedCount, distinct("FAILED"));
  numCheck("converted", campaign.convertedCount, distinct("CONVERTED"));
  strict.push({
    label: "attributedRevenue (== sum of attributed orders)",
    cache: campaign.attributedRevenue.toFixed(2),
    derived: attributedRevenue.toFixed(2),
    ok: campaign.attributedRevenue.equals(attributedRevenue),
  });

  // sentCount is worker-owned: never-overcount is the hard rule; an undercount is a tolerated gap.
  const sentEvents = distinct("SENT");
  const sentShortfall = sentEvents - campaign.sentCount;
  const sentOvercounts = campaign.sentCount > sentEvents;

  const strictFailed = strict.filter((c) => !c.ok);
  const pass = strictFailed.length === 0 && !sentOvercounts;

  const details = strict.map(
    (c) => `${c.ok ? "✓" : "✗"} ${c.label}: cache=${c.cache} eventlog=${c.derived}`,
  );
  let sentLine = `${sentOvercounts ? "✗" : "✓"} sent (worker-owned, best-effort): cache=${campaign.sentCount} sent-events=${sentEvents}`;
  if (sentOvercounts) {
    sentLine += ` → OVERCOUNTS by ${campaign.sentCount - sentEvents} (double-count bug)`;
  } else if (sentShortfall > 0) {
    sentLine += ` → undercounts by ${sentShortfall} (markSent write-failed after the send; not event-reconciled by design — tolerated)`;
  }
  details.push(sentLine);

  let summary: string;
  if (!pass) {
    const reasons = strictFailed.map((c) => c.label);
    if (sentOvercounts) reasons.push("sent (overcount)");
    summary = `${reasons.length} counter check(s) drifted: ${reasons.join(", ")}`;
  } else if (sentShortfall > 0) {
    summary = `all receipt-owned counters match the event log; sentCount undercounts by ${sentShortfall} (tolerated worker-owned gap)`;
  } else {
    summary = `all counters match the event log`;
  }

  return {
    id: 3,
    name: "Counters exact — cache == event-log aggregates",
    pass,
    summary,
    details,
  };
}

/**
 * Invariant #4 — every comm terminal and the campaign COMPLETED. Terminal = not in-flight,
 * i.e. status not QUEUED (never sent) and not SENT (sent, awaiting a delivered/failed receipt).
 * On failure it reports exactly which states are outstanding and why.
 */
export function invariantAllTerminal(
  campaign: CampaignRow,
  comms: CommRow[],
): InvariantResult {
  const inFlight = comms.filter((c) => c.status === "QUEUED" || c.status === "SENT");
  const byStatus = new Map<string, number>();
  for (const c of comms) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);

  const completed = campaign.status === "COMPLETED";
  const pass = completed && inFlight.length === 0;

  const details = [
    `campaign.status = ${campaign.status}` + (completed ? "" : " (expected COMPLETED)"),
    `comm status histogram: ${[...byStatus.entries()]
      .map(([s, n]) => `${s}=${n}`)
      .join(", ")}`,
  ];
  if (inFlight.length > 0) {
    const queued = inFlight.filter((c) => c.status === "QUEUED").length;
    const sent = inFlight.filter((c) => c.status === "SENT").length;
    details.push(
      `outstanding: ${inFlight.length} (QUEUED=${queued} never sent, ` +
        `SENT=${sent} sent but no DELIVERED/FAILED receipt processed)`,
    );
  }
  return {
    id: 4,
    name: "Drained — all comms terminal, campaign COMPLETED",
    pass,
    summary: pass
      ? `campaign COMPLETED; all ${comms.length} comms terminal`
      : `not fully drained (${inFlight.length} in-flight, status=${campaign.status})`,
    details,
  };
}
