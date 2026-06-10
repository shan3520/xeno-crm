/// <reference types="vitest/globals" />
import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { ReceiptsService } from "./receipts.service";
import { ReconcileService } from "./reconcile.service";
import type { ReceiptDto } from "./receipts.dto";

/**
 * DB-backed proof that the FOR UPDATE serialization (FIX 1) closes the lost-update race and
 * that the reconciliation sweep (FIX 2) self-heals drift + completes a terminal campaign.
 *
 * Opt-in (needs a reachable Postgres): the default `pnpm test` run leaves RUN_DB_TESTS unset,
 * so this whole suite SKIPS and the unit run stays fast + hermetic + green. Run it explicitly
 * against a DB (DATABASE_URL is auto-loaded from .env by @prisma/client):
 *   RUN_DB_TESTS=1 pnpm --filter @xeno/crm-api exec vitest run src/receipts/receipts.integration.spec.ts
 * Every row it creates lives under a throwaway workspace that is cascade-deleted in afterAll.
 *
 * (We gate on an explicit flag rather than DATABASE_URL presence because importing the Prisma
 * client side-loads .env, which would make a presence check run these by default locally.)
 */
const runDbTests = process.env.RUN_DB_TESTS === "1";

// Remote Postgres (Neon) round-trips are slow and these tests do many; give them headroom.
const DB_TIMEOUT_MS = 60_000;

const prisma = new PrismaService();
const receipts = new ReceiptsService(prisma);
const reconcile = new ReconcileService(prisma);

const RUN = randomUUID().slice(0, 8);
const workspaceId = `ws_test_${RUN}`;
const customerId = `cust_test_${RUN}`;

let campaignSeq = 0;
const newCampaign = async (): Promise<string> => {
  const id = `camp_test_${RUN}_${campaignSeq++}`;
  await prisma.campaign.create({
    data: {
      id,
      workspaceId,
      name: `recon-test-${id}`,
      goal: "test",
      channel: "EMAIL",
      messageTemplate: "hi",
      status: "SENDING",
    },
  });
  return id;
};

let commSeq = 0;
const newComm = async (
  campaignId: string,
  status: "QUEUED" | "SENT" | "DELIVERED" | "CLICKED",
): Promise<string> => {
  const id = `comm_test_${RUN}_${commSeq++}`;
  await prisma.communication.create({
    data: {
      id,
      campaignId,
      customerId,
      channel: "EMAIL",
      recipientAddress: "x@example.com",
      renderedMessage: "hi",
      status,
    },
  });
  return id;
};

const addEvent = async (
  communicationId: string,
  type: "SENT" | "DELIVERED" | "OPENED" | "READ" | "CLICKED" | "FAILED",
  occurredAt: string,
  payload: Record<string, unknown> = {},
): Promise<void> => {
  await prisma.communicationEvent.create({
    data: {
      communicationId,
      type,
      occurredAt: new Date(occurredAt),
      payload: payload as Prisma.InputJsonValue,
      idempotencyKey: `${communicationId}:${type}:${randomUUID()}`,
    },
  });
};

const receipt = (
  communicationId: string,
  type: ReceiptDto["type"],
  occurredAt: string,
): ReceiptDto =>
  ({
    communicationId,
    providerMessageId: `pm_${randomUUID().slice(0, 8)}`,
    type,
    occurredAt,
    idempotencyKey: `${communicationId}:${type}:${randomUUID()}`,
    payload: {},
  }) as ReceiptDto;

describe.skipIf(!runDbTests)("receipts concurrency + reconcile (DB)", () => {
  beforeAll(async () => {
    await prisma.workspace.create({ data: { id: workspaceId, name: `test-${RUN}` } });
    await prisma.customer.create({
      data: {
        id: customerId,
        workspaceId,
        externalId: `EXT_${RUN}`,
        firstName: "Test",
        lastName: "User",
        email: "x@example.com",
      },
    });
  }, DB_TIMEOUT_MS);

  afterAll(async () => {
    // Cascades through campaigns → communications → events, and the customer.
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
    await prisma.$disconnect();
  }, DB_TIMEOUT_MS);

  it("FIX 1: concurrent SENT+DELIVERED for the same comm never regress to SENT", async () => {
    const campaignId = await newCampaign();
    const ids: string[] = [];
    const N = 6;
    // Seed as SENT (not QUEUED) so a live send-worker draining this shared DB never claims
    // these rows out from under the test — the projection race is driven purely by the
    // receipt events below, so the seed status is immaterial to what we're proving.
    for (let i = 0; i < N; i++) ids.push(await newComm(campaignId, "SENT"));

    // For each comm, fire its SENT and DELIVERED callbacks CONCURRENTLY — that pair is the
    // race: two read-modify-writes on the SAME row where, without the lock, SENT (committing
    // last) can clobber DELIVERED. We iterate comms sequentially so we exercise the per-row
    // race repeatedly without flooding the connection pool (which is the very failure that
    // triggered this incident). With FIX 1 the pair serializes and the loser re-projects the
    // full event set, so the result is always DELIVERED regardless of commit order.
    for (const id of ids) {
      await Promise.all([
        receipts.ingest(receipt(id, "SENT", "2026-06-01T10:00:00Z")),
        receipts.ingest(receipt(id, "DELIVERED", "2026-06-01T10:00:01Z")),
      ]);
    }

    const rows = await prisma.communication.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
    });
    expect(rows).toHaveLength(N);
    for (const r of rows) {
      expect(r.status).toBe("DELIVERED"); // serialized → projection sees the full set
    }
  }, DB_TIMEOUT_MS);

  it("FIX 2: sweep heals a status regressed BEHIND its events and completes the campaign", async () => {
    const campaignId = await newCampaign();
    // A comm that the race left pinned at SENT though its events say DELIVERED.
    const regressed = await newComm(campaignId, "SENT");
    await addEvent(regressed, "SENT", "2026-06-01T10:00:00Z");
    await addEvent(regressed, "DELIVERED", "2026-06-01T10:00:01Z");
    // A second comm pinned at SENT though it actually FAILED.
    const failed = await newComm(campaignId, "SENT");
    await addEvent(failed, "SENT", "2026-06-01T10:00:00Z");
    await addEvent(failed, "FAILED", "2026-06-01T10:00:02Z", { reason: "hard bounce" });
    // Stale counter to prove the recompute converges.
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { deliveredCount: 0, failedCount: 0 },
    });

    const result = await reconcile.reconcileCampaign(campaignId);
    expect(result.healed).toBe(2);
    expect(result.completed).toBe(true);

    const [r1, r2, camp] = await Promise.all([
      prisma.communication.findUnique({ where: { id: regressed }, select: { status: true } }),
      prisma.communication.findUnique({
        where: { id: failed },
        select: { status: true, failureReason: true },
      }),
      prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { status: true, deliveredCount: true, failedCount: true },
      }),
    ]);
    expect(r1?.status).toBe("DELIVERED");
    expect(r2?.status).toBe("FAILED");
    expect(r2?.failureReason).toBe("hard bounce");
    expect(camp?.status).toBe("COMPLETED");
    expect(camp?.deliveredCount).toBe(1);
    expect(camp?.failedCount).toBe(1);
  }, DB_TIMEOUT_MS);

  it("FIX 2: sweep never downgrades a correctly-advanced comm and is idempotent", async () => {
    const campaignId = await newCampaign();
    const clicked = await newComm(campaignId, "CLICKED");
    for (const [t, ts] of [
      ["SENT", "2026-06-01T10:00:00Z"],
      ["DELIVERED", "2026-06-01T10:00:01Z"],
      ["OPENED", "2026-06-01T10:00:02Z"],
      ["READ", "2026-06-01T10:00:03Z"],
      ["CLICKED", "2026-06-01T10:00:04Z"],
    ] as const) {
      await addEvent(clicked, t, ts);
    }

    const first = await reconcile.reconcileCampaign(campaignId);
    expect(first.healed).toBe(0); // already correct — nothing to heal
    expect(first.completed).toBe(true); // CLICKED is not in-flight → completes

    const again = await reconcile.reconcileCampaign(campaignId);
    expect(again.healed).toBe(0);
    expect(again.completed).toBe(false); // already COMPLETED — one-way flip

    const row = await prisma.communication.findUnique({
      where: { id: clicked },
      select: { status: true },
    });
    expect(row?.status).toBe("CLICKED");
  }, DB_TIMEOUT_MS);
});
