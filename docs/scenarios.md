# Demo scenarios + load harness

Two things live here:

1. **Three on-camera console scenarios** — the scripted marketer journeys to demo the
   AI-native campaign console (state intent in plain English → review an editable segment rule,
   message copy, and a results narrative → approve → watch the lifecycle).
2. **The load + chaos harness** — how to prove the send loop is correct under volume.

All numbers below come from the deterministic seed (`pnpm db:seed`, fixed faker seed) against
the single seeded workspace **“Looms — D2C apparel”** (~2,000 customers, ~6,000 orders). Confirm
any audience size live with the segment preview card in the console (or
`POST /segments/preview`).

---

## On-camera console scenarios

For each: the **exact intent** to type, the **segment rule** the AI is expected to emit (the
editable DSL the marketer reviews), the **expected audience**, a **message** angle, and the
**dashboard focus** to land on camera. Channel is **EMAIL** unless noted (every seeded customer
has an email, so the audience is fully reachable).

### 1. Lapsed-sneaker win-back  ·  expected audience ≈ **799**

> **Type into the console:**
> *“Win back customers who bought sneakers from us but haven’t ordered anything in the last 2
> months. Offer them 15% off their next pair.”*

**Segment rule the AI emits (review/edit this):**

```json
{
  "op": "AND",
  "conditions": [
    { "field": "order_item.category", "operator": "eq", "value": "sneakers" },
    { "field": "customer.last_order_at", "operator": "older_than_days", "value": 60 }
  ]
}
```

**Message angle:** personalised win-back — `Hi {{firstName}}, your next pair is calling.` with a
15%-off code; warm, low-pressure.

**Dashboard focus:** this is the hero cohort the seed guarantees. On camera, open the campaign
stats and walk the **funnel** (sent → delivered → opened → clicked → converted) and the
**attributed-revenue** tile — the win-back framing makes conversions the headline.

### 2. VIP / tier early-access  ·  expected audience ≈ **593**

> **Type into the console:**
> *“Give our gold and platinum members early access to the new drop, 24 hours before everyone
> else.”*

**Segment rule the AI emits:**

```json
{
  "op": "AND",
  "conditions": [
    { "field": "customer.tier", "operator": "in", "value": ["gold", "platinum"] }
  ]
}
```

To tighten to true VIPs, add a spend floor (drops the audience to ≈ **380**):

```json
{ "field": "customer.total_spend", "operator": "gte", "value": 20000 }
```

**Message angle:** exclusivity — `{{firstName}}, you’re in first.` a private early-access link;
status-forward copy.

**Dashboard focus:** contrast the **open/click rates** against the win-back campaign — VIPs
engage harder, so the **derived rates** (delivery / open / click) are the story here, not raw
volume.

### 3. Abandoned-category nudge  ·  expected audience ≈ **550**

> **Type into the console:**
> *“Nudge people who used to buy denim from us but have gone quiet for over three months — show
> them what’s new in denim.”*

**Segment rule the AI emits:**

```json
{
  "op": "AND",
  "conditions": [
    { "field": "order_item.category", "operator": "eq", "value": "denim" },
    { "field": "customer.last_order_at", "operator": "older_than_days", "value": 90 }
  ]
}
```

**Message angle:** category re-engagement — `New denim just landed, {{firstName}}.` lead with
fit/restock, no discount needed.

**Dashboard focus:** show the **timeline** chart filling in as the stub’s jittered callbacks
arrive out of order, and the **failure breakdown** tile — a clean way to demonstrate that status
is a projection over the event log, not arrival order.

> Swap `denim` for `tees`, `outerwear`, or `accessories` to re-run the same shape against a
> different category if you want a second take.

---

## Running the load + chaos harness

The harness drives a configurable volume of communications through the **full live loop**
(launch → in-process worker → channel-stub `/send` → jittered callbacks → `/receipts` → event
projection), then asserts the four correctness invariants. Full reference:
[`tools/load/README.md`](../tools/load/README.md).

### Bring the stack up first

It does **not** start anything — run the stack in two terminals (and seed once):

```sh
pnpm db:seed                                    # deterministic data (run once)
corepack pnpm --filter @xeno/crm-api dev        # crm-api  :3001 (worker auto-loops)
corepack pnpm --filter @xeno/channel-stub dev   # stub     :3002
```

### Run it

```sh
pnpm load --count 200     # smoke run — confirm the loop is healthy first
pnpm load --count 500     # the headline run
```

Throughput is bounded by the worker rate **and** round-trip latency to Neon (~1 send/sec
against remote Neon), so 500 takes several minutes to fully drain. The harness sizes a segment
to hit the requested count, launches it, then polls until the campaign is `COMPLETED` and the
event log has gone quiet.

### Reading the output

While draining, each line shows the funnel, **throughput** (sends/sec), and **receipt lag**:

```
[t+232.9s] SENDING sent=27/200 delivered=16 opened=11 read=8 clicked=4 conv=1 failed=1
           | thr=0.1/s | lag avg=-27242ms p95=2655ms max=15392ms | events=61
```

`lag` = `receivedAt − occurredAt`; it is routinely negative because `occurredAt` is the stub’s
**simulated** channel time (jittered up to `MAX_DELAY_MS`), not wall-clock arrival — it measures
projection skew, not latency.

Then it prints `PASS`/`FAIL` for each invariant and exits `0` only if all pass:

| # | Invariant | What it proves |
| - | --------- | -------------- |
| 1 | **Idempotency** | duplicate stub callbacks (same `idempotencyKey`) produced no duplicate events |
| 2 | **Monotonic status** | every comm’s stored status equals `projectCommunication(events)` — no lost-update regression |
| 3 | **Counters exact** | the receipt-owned counters (delivered/opened/read/clicked/failed/converted + `attributedRevenue`) equal the event-log aggregate; `queuedCount` == total comms. `sentCount` is worker-owned (best-effort) — it must never *over*count SENT events; an undercount under a write-failure is reported, not failed |
| 4 | **Drained** | campaign `COMPLETED` and every comm terminal — else it lists exactly what is outstanding and why |

**Reading a FAIL.** Invariant #4 is the one most sensitive to the environment: the stub posts
callbacks fire-and-forget with **no retry**, so if crm-api briefly can’t reach the DB a single
`DELIVERED`/`FAILED` callback can be lost, leaving one comm wedged in `SENT` and the campaign
never `COMPLETED`. The harness detects the resulting tail-stall (event log quiet but not
completed), stops waiting, and reports the stuck comm — a correct, honest failure, not a harness
defect. Re-run against a stable database for a clean green.
