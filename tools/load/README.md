# @xeno/load — load + chaos harness

Drives a configurable volume of communications through the **full live loop** and then
asserts the correctness invariants the CRM is built on:

```
launch → in-process send-worker → channel-stub /send → jittered stub callbacks
       → crm-api /receipts → event projection → projection-cache counters
```

It is a **test / observability tool**, not a service. Load is generated **only through the
public REST API**; the post-run assertions read the database **read-only** and compare the
append-only `CommunicationEvent` log (the source of truth) against the materialized
projections (`Communication.status` + the `Campaign` counters). It exits **non-zero** if any
invariant fails, so it doubles as a CI-style correctness gate — the same class a prior
concurrency (lost-update) bug violated.

## Prerequisites

The harness assumes the stack is **already running locally** — it does not start it. In two
terminals:

```sh
corepack pnpm --filter @xeno/crm-api dev        # crm-api  :3001 (worker auto-loops)
corepack pnpm --filter @xeno/channel-stub dev   # stub     :3002
```

Both must be healthy (`/health`) and pointed at a **seeded** database (`pnpm db:seed`). The
harness reads `DATABASE_URL` + `CHANNEL_STUB_URL` from `apps/crm-api/.env` if they are not
already in the environment, so it talks to the **same** database the API writes to.

> Local only. Never point this at production — it creates campaigns and drives real sends
> through the stub.

## Run

```sh
pnpm load                 # default --count 500
pnpm load --count 200     # smaller, faster smoke run
pnpm load --count 1000    # larger
```

Start small (`--count 200`) to confirm the loop is healthy before a bigger run. Throughput is
bounded by the worker's `SEND_RATE_PER_SEC` **and** round-trip latency to the database; against
remote Neon expect on the order of ~1 send/sec, so 500 takes several minutes to fully drain.

### Flags (all optional; env fallback in parens)

| Flag              | Default                  | Meaning                                                            |
| ----------------- | ------------------------ | ----------------------------------------------------------------- |
| `--count`         | `500` (`LOAD_COUNT`)     | Target number of communications. Audience is sized to meet/exceed it. |
| `--crm-url`       | `http://localhost:3001` (`CRM_URL`) | Base URL of crm-api — the only service the harness calls.          |
| `--stub-url`      | `http://localhost:3002` (`STUB_URL`/`CHANNEL_STUB_URL`) | channel-stub base URL — used only for a preflight `/health` check. |
| `--channel`       | `EMAIL` (`LOAD_CHANNEL`) | Send channel. EMAIL reaches every seeded customer (all have email). |
| `--database-url`  | `DATABASE_URL`           | Postgres URL for the read-only assertions.                         |
| `--timeout`       | `20000`                  | Per-request HTTP timeout (ms).                                     |
| `--poll-ms`       | `2000`                   | Poll cadence while draining (ms).                                  |
| `--quiet-ms`      | `35000`                  | Quiescence window — see below. **Must exceed the stub's `MAX_DELAY_MS`.** |
| `--drain-timeout` | `1200000`                | Overall ceiling launch→drained (ms) before giving up.             |

## What it does, step by step

1. **Preflight** — confirms crm-api + channel-stub `/health`, that a domain route responds
   (`POST /segments/preview`), and that the DB is reachable for the read path.
2. **Sizes the audience** to the target `N` using only `POST /segments/preview`: it binary-searches
   a single `customer.total_spend` threshold for the smallest audience `>= N`, so it hits the
   requested volume without massively overshooting (overshoot = wasted sends).
3. **Creates + launches** a campaign over that segment (`POST /segments`, `POST /campaigns`,
   `POST /campaigns/:id/launch`).
4. **Drains** the loop, polling `GET /campaigns/:id/stats` and printing, each tick: the funnel,
   **throughput** (sends/sec), and **receipt lag** (`receivedAt − occurredAt`). It waits for the
   campaign to reach `COMPLETED` **and** for the event log to go quiet for `--quiet-ms` (so late
   engagement/duplicate callbacks are not raced — `occurredAt` jitter is up to the stub's
   `MAX_DELAY_MS`, default 30 s).
5. **Asserts** the four invariants read-only and prints `PASS`/`FAIL` for each.

### Reading the live line

```
[t+232.9s] SENDING sent=27/200 delivered=16 opened=11 read=8 clicked=4 conv=1 failed=1
           | thr=0.1/s | lag avg=-27242ms p95=2655ms max=15392ms | events=61
```

- `thr` — sends per second since launch (DB-latency bound, not the configured rate).
- `lag` — `receivedAt − occurredAt` across this campaign's events. `occurredAt` is the stub's
  **simulated** channel time (advanced by up to `MAX_DELAY_MS` per step), while the callback may
  fire on an independent timer, so the value is routinely **negative** (a callback can land before
  its simulated occurrence). It is reported as-is; it measures projection skew, not wall latency.
- `events` — total `CommunicationEvent` rows for the campaign; quiescence is declared when this
  stops growing for `--quiet-ms`.

## The four invariants (and how to read a failure)

Every assertion is scoped to the campaign the run just launched, and compares the **event log**
to the **projections**.

1. **Idempotency — no duplicate events.** The stub deliberately re-sends some callbacks (same
   `idempotencyKey`); the receipt handler must dedupe them. Checks that every scoped event has a
   distinct `idempotencyKey` and that no comm holds two events of the same type.
   *Failure* ⇒ the dedupe path let a duplicate through (a callback was double-counted).

2. **Monotonic status — stored == projection(events).** For every comm, the stored
   `Communication.status` must equal `projectCommunication(itsFullEventSet)` — the **same**
   reference projector the receipt handler uses (imported read-only). A status **BEHIND** its
   events is exactly the lost-update bug class that was fixed (a lower-precedence receipt
   committing last and clobbering a higher one); a status **AHEAD** of its events is a different
   anomaly. Either fails, and offending comms are listed `id: stored=X BEHIND/AHEAD events→Y`.

3. **Counters exact — cache == event-log aggregates.** The CRM keeps two *classes* of counter,
   and the harness mirrors the contract the reconcile sweep encodes (`recomputeCounters`):
   - **Receipt-owned** — `deliveredCount`/`openedCount`/`readCount`/`clickedCount`/`failedCount`/
     `convertedCount` and `attributedRevenue` are re-derived from the event log (distinct comms
     per event type; revenue = sum of attributed orders). These **must** match exactly — asserted
     strictly. Plus `queuedCount` == total comms created at launch.
   - **Worker-owned** — `sentCount` counts successful worker `markSent` transactions, **not** SENT
     events, and the system deliberately never event-reconciles it. It may legitimately *undercount*
     the SENT events when a `markSent` write fails *after* the send already happened (the channel
     got the send, a SENT event lands, the receipt path advances the comm, but the worker never
     recorded the increment). So the asserted rule is "never **over**counts" (an overcount = a
     double-count bug); an undercount is reported as a tolerated gap, not a failure.

   *Failure* lists which counters drifted (`cache=… eventlog=…`).

4. **Drained — all comms terminal, campaign COMPLETED.** The campaign must be `COMPLETED` and no
   comm may still be in-flight (`QUEUED` = never sent, or `SENT` = sent but no delivered/failed
   receipt yet). *Failure* prints the status histogram and exactly what is outstanding and why —
   e.g. the run hit `--drain-timeout`, or `--quiet-ms` is shorter than the stub's `MAX_DELAY_MS`.

A green run prints throughput + time-to-drain + receipt lag, then `PASS` on all four and exits 0.
Any failed invariant (or a failure to drain) exits 1.
