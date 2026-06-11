/**
 * Load + chaos harness for the Xeno CRM send loop.
 *
 * Drives a configurable volume of communications through the FULL live path —
 * launch → in-process worker → channel-stub /send → jittered stub callbacks →
 * crm-api /receipts → event projection — against the LOCALLY running stack, then asserts the
 * correctness invariants the system is built on (the class a prior concurrency bug violated).
 *
 * Load is generated ONLY through the public REST API; the post-run assertions read the DB
 * read-only and compare the append-only event log (source of truth) against the materialized
 * projections. Exits non-zero if any invariant fails, so it works as a CI-style gate.
 *
 * Usage: pnpm load --count 500   (with crm-api :3001 + channel-stub :3002 running)
 */
import { CrmApiClient, probeHealth } from "./api";
import {
  invariantAllTerminal,
  invariantCountersExact,
  invariantNoDuplicates,
  invariantStatusMonotonic,
  type InvariantResult,
} from "./assertions";
import { parseOptions, type LoadOptions } from "./cli";
import {
  attributedRevenueFromOrders,
  loadCampaign,
  loadComms,
  loadEvents,
  makeReadClient,
} from "./db";
import { createAndLaunch, drainAndObserve } from "./drive";
import { sizeSegmentForCount } from "./segment";

function banner(title: string): void {
  console.log(`\n${"━".repeat(74)}\n  ${title}\n${"━".repeat(74)}`);
}

async function preflight(opts: LoadOptions, api: CrmApiClient): Promise<void> {
  banner("Preflight — local stack must be up");
  const [crm, stub] = await Promise.all([
    probeHealth(opts.crmUrl, opts.httpTimeoutMs),
    probeHealth(opts.stubUrl, opts.httpTimeoutMs),
  ]);
  console.log(`  crm-api      ${opts.crmUrl}  ${crm.ok ? "OK" : "DOWN"} (${crm.detail})`);
  console.log(`  channel-stub ${opts.stubUrl}  ${stub.ok ? "OK" : "DOWN"} (${stub.detail})`);
  if (!crm.ok || !stub.ok) {
    throw new Error(
      "Local stack not reachable. Start it in two terminals:\n" +
        "    corepack pnpm --filter @xeno/crm-api dev\n" +
        "    corepack pnpm --filter @xeno/channel-stub dev",
    );
  }
  // Cheap auth-free confirmation that the API is actually serving domain routes.
  await api.previewSegment({
    op: "AND",
    conditions: [{ field: "customer.order_count", operator: "gte", value: 0 }],
  });
  console.log("  domain routes responding (POST /segments/preview OK)");
}

function reportInvariants(results: InvariantResult[]): boolean {
  banner("Invariants (event log = source of truth)");
  let allPass = true;
  for (const r of results) {
    allPass = allPass && r.pass;
    console.log(`\n  [${r.pass ? "PASS" : "FAIL"}] #${r.id} ${r.name}`);
    console.log(`        ${r.summary}`);
    for (const d of r.details) console.log(`          - ${d}`);
  }
  return allPass;
}

async function main(): Promise<number> {
  const opts = parseOptions(process.argv.slice(2));
  const api = new CrmApiClient(opts.crmUrl, opts.httpTimeoutMs);

  banner("Load + chaos harness");
  console.log(`  target count : ${opts.count}`);
  console.log(`  crm-api      : ${opts.crmUrl}`);
  console.log(`  channel-stub : ${opts.stubUrl}`);
  console.log(`  channel      : ${opts.channel}`);
  console.log(`  quiet window : ${opts.quietMs}ms (must exceed stub MAX_DELAY_MS)`);
  console.log(`  drain timeout: ${opts.drainTimeoutMs}ms`);

  await preflight(opts, api);

  const prisma = makeReadClient(opts.databaseUrl);
  // A fresh client triggers a cold connect; Neon (free tier) may be scaled to zero and take a
  // few seconds to wake, so retry the probe before giving up.
  let dbErr: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbErr = undefined;
      break;
    } catch (err) {
      dbErr = err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  if (dbErr) {
    await prisma.$disconnect();
    const reason = dbErr instanceof Error ? dbErr.message : String(dbErr);
    throw new Error(`Cannot reach the database for read-only assertions: ${reason}`);
  }

  try {
    banner("Sizing the audience via /segments/preview");
    const sized = await sizeSegmentForCount(api, opts.count);
    console.log(
      `  chose audience=${sized.count} for target=${opts.count} ` +
        `(${sized.probes} preview probes)`,
    );
    if (sized.capped) {
      console.log(
        `  ⚠ whole reachable workspace (${sized.count}) is smaller than target ` +
          `${opts.count}; driving ${sized.count}.`,
      );
    }

    banner("Launching campaign");
    const { campaignId, launch, launchedAtMs } = await createAndLaunch(
      api,
      sized.definition,
      opts.channel,
    );
    console.log(
      `  campaign ${campaignId} launched: audienceSize=${launch.audienceSize} ` +
        `queued=${launch.counters.queued} skippedNoAddress=${launch.skippedNoAddress}`,
    );

    banner("Draining the loop (live)");
    const drain = await drainAndObserve(api, prisma, campaignId, launchedAtMs, {
      pollMs: opts.pollMs,
      drainTimeoutMs: opts.drainTimeoutMs,
      quietMs: opts.quietMs,
    });

    banner("Run summary");
    console.log(`  drained        : ${drain.drained ? "yes" : "NO (timed out)"}`);
    console.log(
      `  time-to-drain  : ${
        drain.timeToCompleteMs !== null
          ? `${(drain.timeToCompleteMs / 1000).toFixed(1)}s (launch → COMPLETED)`
          : "never completed"
      }`,
    );
    console.log(`  throughput     : ${drain.throughputPerSec.toFixed(1)} sends/sec`);
    console.log(
      `  receipt lag    : avg=${drain.lag.avgMs.toFixed(0)}ms ` +
        `p95=${drain.lag.p95Ms.toFixed(0)}ms max=${drain.lag.maxMs.toFixed(0)}ms ` +
        `(receivedAt − occurredAt, over ${drain.lag.n} events)`,
    );

    // Read-only assertion inputs.
    const [campaign, comms, events, revenue] = await Promise.all([
      loadCampaign(prisma, campaignId),
      loadComms(prisma, campaignId),
      loadEvents(prisma, campaignId),
      attributedRevenueFromOrders(prisma, campaignId),
    ]);

    const results = [
      invariantNoDuplicates(events),
      invariantStatusMonotonic(comms, events),
      invariantCountersExact(campaign, comms, events, revenue),
      invariantAllTerminal(campaign, comms),
    ];
    const invariantsPass = reportInvariants(results);
    const ok = invariantsPass && drain.drained;

    banner(ok ? "RESULT: PASS ✓" : "RESULT: FAIL ✗");
    if (!drain.drained) {
      console.log("  loop did not drain within the timeout — see invariant #4 above.");
    }
    return ok ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`\n✗ load harness error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
