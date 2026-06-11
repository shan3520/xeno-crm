import type { PrismaClient } from "@prisma/client";

import type { CampaignStats, CrmApiClient, LaunchResult } from "./api";
import { countEvents, lagStats, type LagStats } from "./db";
import type { SegmentDefinition } from "@xeno/shared";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function fmtMs(ms: number): string {
  return `${ms >= 0 ? "" : "-"}${Math.abs(ms).toFixed(0)}ms`;
}

/**
 * Retry a transient operation a few times before surfacing the error. Neon (free tier) can
 * briefly drop connections under the worker + harness load; a poll tick should ride that out
 * rather than abort an otherwise-healthy run.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts: number, label: string): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await sleep(500 * (i + 1));
    }
  }
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`${label} failed after ${attempts} attempts: ${reason}`);
}

/** Create a named segment + campaign, then launch. Returns the launch result + timing. */
export async function createAndLaunch(
  api: CrmApiClient,
  definition: SegmentDefinition,
  channel: string,
): Promise<{ campaignId: string; launch: LaunchResult; launchedAtMs: number }> {
  const tag = new Date().toISOString().replace(/[:.]/g, "-");
  const segment = await api.createSegment({
    name: `load-harness ${tag}`,
    description: "Audience materialized by the load + chaos harness (tools/load).",
    definition,
  });
  const campaign = await api.createCampaign({
    name: `load-harness ${tag}`,
    goal: "Drive N communications through the full live loop and assert invariants.",
    segmentId: segment.id,
    channel,
    messageTemplate: "Hi {{firstName}}, a quick note from the team — load-harness run.",
  });

  const launchedAtMs = Date.now();
  const launch = await api.launchCampaign(campaign.id);
  return { campaignId: campaign.id, launch, launchedAtMs };
}

export interface DrainResult {
  drained: boolean;
  finalStats: CampaignStats;
  /** Wall time launch -> COMPLETED (ms); null if it never completed. */
  timeToCompleteMs: number | null;
  /** sent / time-to-complete. */
  throughputPerSec: number;
  lag: LagStats;
}

export interface DrainOptions {
  pollMs: number;
  drainTimeoutMs: number;
  quietMs: number;
}

/**
 * Poll /campaigns/:id/stats until the campaign is COMPLETED AND the event log has gone quiet
 * for quietMs (late engagement/duplicate callbacks have stopped arriving). Prints throughput,
 * funnel, and receipt-lag each tick. Returns the final observation for the assertion phase.
 */
export async function drainAndObserve(
  api: CrmApiClient,
  prisma: PrismaClient,
  campaignId: string,
  launchedAtMs: number,
  opts: DrainOptions,
): Promise<DrainResult> {
  // Tolerate transient blips: skip a tick on error, only give up after a long stretch.
  const MAX_CONSECUTIVE_MISSES = 12;
  let consecutiveMisses = 0;

  let lastEventCount = -1;
  let lastChangeAt = Date.now();
  let completedAtMs: number | null = null;
  let stats = await withRetry(() => api.campaignStats(campaignId), 5, "initial stats");
  let lag: LagStats = { n: 0, avgMs: 0, p95Ms: 0, maxMs: 0 };

  const buildResult = (drained: boolean): DrainResult => {
    const ttc = completedAtMs !== null ? completedAtMs - launchedAtMs : null;
    const throughputPerSec = ttc && ttc > 0 ? (stats.funnel.sent / ttc) * 1000 : 0;
    return { drained, finalStats: stats, timeToCompleteMs: ttc, throughputPerSec, lag };
  };

  for (;;) {
    const now = Date.now();
    const elapsedMs = now - launchedAtMs;

    let events: number;
    try {
      [stats, lag] = await Promise.all([
        withRetry(() => api.campaignStats(campaignId), 3, "stats"),
        withRetry(() => lagStats(prisma, campaignId), 3, "lag"),
      ]);
      events = await withRetry(() => countEvents(prisma, campaignId), 3, "countEvents");
      consecutiveMisses = 0;
    } catch (err) {
      consecutiveMisses++;
      const reason = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `[t+${(elapsedMs / 1000).toFixed(1)}s] ⚠ poll tick skipped ` +
          `(${consecutiveMisses}/${MAX_CONSECUTIVE_MISSES}): ${reason}\n`,
      );
      if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
        throw new Error(`Polling gave up after ${consecutiveMisses} consecutive failures`);
      }
      if (elapsedMs >= opts.drainTimeoutMs) return buildResult(false);
      await sleep(opts.pollMs);
      continue;
    }

    if (events !== lastEventCount) {
      lastEventCount = events;
      lastChangeAt = now;
    }

    const completed = stats.campaign.status === "COMPLETED";
    if (completed && completedAtMs === null) completedAtMs = now;

    const f = stats.funnel;
    const thr = elapsedMs > 0 ? (f.sent / elapsedMs) * 1000 : 0;
    const quietFor = now - lastChangeAt;
    process.stdout.write(
      `[t+${(elapsedMs / 1000).toFixed(1)}s] ${stats.campaign.status} ` +
        `sent=${f.sent}/${stats.campaign.audienceSize} delivered=${f.delivered} ` +
        `opened=${f.opened} read=${f.read} clicked=${f.clicked} conv=${f.converted} ` +
        `failed=${f.failed} | thr=${thr.toFixed(1)}/s | ` +
        `lag avg=${fmtMs(lag.avgMs)} p95=${fmtMs(lag.p95Ms)} max=${fmtMs(lag.maxMs)} | ` +
        `events=${events}${completed ? ` | quiet=${(quietFor / 1000).toFixed(0)}s` : ""}\n`,
    );

    if (completed && quietFor >= opts.quietMs) return buildResult(true);

    // Tail-stall detection: the campaign is NOT completed yet the event log has gone quiet for
    // a long stretch. That means the remaining in-flight comms are wedged (e.g. a stub callback
    // was lost — the stub posts fire-and-forget with no retry — so a comm is stuck in SENT and
    // the completion gate never fires). Proceed to assertions promptly with an honest non-drain
    // rather than hanging until --drain-timeout. lastEventCount>0 guards against a slow cold
    // start (no events yet) being mistaken for a stall.
    const stallMs = Math.max(opts.quietMs * 2, 90_000);
    if (!completed && lastEventCount > 0 && quietFor >= stallMs) {
      process.stdout.write(
        `\n  ⚠ tail stall: campaign still ${stats.campaign.status} but no new events for ` +
          `${(quietFor / 1000).toFixed(0)}s — proceeding to assertions (will report what is ` +
          `outstanding).\n`,
      );
      return buildResult(false);
    }

    if (elapsedMs >= opts.drainTimeoutMs) return buildResult(false);

    await sleep(opts.pollMs);
  }
}
