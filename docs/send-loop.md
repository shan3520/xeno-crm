# The Send / Callback Loop

This is the heart of the system and where most of the system-design thinking lives. The brief calls
out exactly this: *"How you handle volume, ordering, retries, and failures in this loop is exactly the
kind of system-design thinking we want to see."*

The loop spans all three services:

```
crm-api worker ──POST /send──► channel-stub ──(jittered timers)──► POST /receipts ──► crm-api projection
```

## 1. Launch: freeze the audience

`POST /campaigns/:id/launch` ([campaigns.service.ts](../apps/crm-api/src/campaigns/campaigns.service.ts)):

1. Compiles the campaign's segment to SQL and **freezes** the matching audience.
2. Renders the message template per recipient (resolving `{{tokens}}`), skipping recipients with no
   address for the channel (e.g. SMS with no phone → reported as *skipped (no address)*).
3. Writes one `QUEUED` `Communication` row per recipient.
4. Flips the campaign to `SENDING`.
5. Is **guarded** so a campaign that is already `SENDING`/`COMPLETED` cannot be double-launched
   (returns `409`).

Launch does **not** send anything — it only enqueues. Sending is the worker's job.

## 2. The queue: the DB row *is* the work item

There is **no Redis and no BullMQ**. Each `Communication` row carries its own queue state:

| Field | Purpose |
| --- | --- |
| `status` | `QUEUED` is the claimable state; `SENT`/`FAILED` are terminal-for-the-worker |
| `attemptCount` | how many send attempts have been made |
| `nextAttemptAt` | not eligible to be claimed before this time (backoff) |
| `lockedAt` / `lockedBy` | the lease — who is processing this row, and since when |

### Claiming — `FOR UPDATE SKIP LOCKED`

The worker ([send-worker.service.ts](../apps/crm-api/src/send-worker/send-worker.service.ts)) claims a
batch in **one transaction** with raw SQL (Prisma can't express it):

```sql
SELECT "id" FROM "Communication"
WHERE "status" = 'QUEUED'
  AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now())
  AND ("lockedAt" IS NULL OR "lockedAt" < now() - lease)
ORDER BY "nextAttemptAt" ASC
FOR UPDATE SKIP LOCKED
LIMIT :workerConcurrency
```

`FOR UPDATE SKIP LOCKED` is what makes this safe under concurrency: two workers scanning at once never
grab the same row — each skips rows the other has locked. The claimed rows are then stamped with the
lease (`lockedAt = now`, `lockedBy = instanceId`).

### Lease

`LEASE_MS = 60s`. A row is only re-claimable once `lockedAt < now − LEASE_MS`. This is the crash-safety
mechanism: if a worker dies mid-send, its in-flight rows become reclaimable within a minute. The lease
is comfortably longer than the 10s per-send HTTP ceiling, so a healthy worker always finishes inside
its lease (avoiding a double-send).

### Rate limiting

Sends are spaced at `1000 / SEND_RATE_PER_SEC` ms per worker instance — a simple, predictable
throttle that keeps the worker from hammering the stub (or, in reality, a provider's rate limit).

## 3. Send → SENT (or retry, or dead-letter)

For each claimed row the worker `POST`s to channel-stub `/send` with `{ communicationId, channel,
recipientAddress, renderedMessage }` and gets back a `providerMessageId`.

- **Success** → `markSent`: `status = SENT`, store `providerMessageId`, bump `campaign.sentCount`.
  Guarded on `status = 'QUEUED'` so it is idempotent (a row that already advanced is a no-op).
- **Failure** → `markFailure`, which classifies the failure:

| Failure kind | Examples | Behaviour |
| --- | --- | --- |
| **Transient** | stub `429` (throttle), any `5xx` (incl. Render cold-start `502/503/504`), network/timeout | Retry with capped exponential backoff, **never dead-letter**. `attemptCount` still increments for observability. |
| **Permanent** | other `4xx`, contract violation (2xx with no `providerMessageId`) | Counts toward `WORKER_MAX_ATTEMPTS`; dead-letters to `FAILED` when exhausted, bumping `campaign.failedCount`. |

The transient/permanent split is deliberate: a cold free-tier stub returning `429`s should not burn a
whole batch's retry budget in the ~50s it takes to wake. Permanent client errors *should* fail fast.
(See [failure-classification.ts](../apps/crm-api/src/send-worker/failure-classification.ts).)

### Backoff

Exponential with **equal jitter** — `delay = ceiling/2 + random(0, ceiling/2)`, where the ceiling is
`BASE × 2^(attempt-1)` capped at 5 minutes ([backoff.ts](../apps/crm-api/src/send-worker/backoff.ts)).
Jitter spreads retries so a fleet of workers doesn't thunder back in lockstep.

## 4. The channel-stub: simulating the lifecycle

`POST /send` ([main.ts](../apps/channel-stub/src/main.ts)) validates the request, returns a
`providerMessageId` **immediately**, and schedules the lifecycle on **jittered in-memory timers** — it
never blocks the response and never delivers anything real.

The lifecycle ([lifecycle.ts](../apps/channel-stub/src/lifecycle.ts)) walks a probabilistic funnel
driven by env-configurable rates: `DELIVERED_RATE`, `OPEN_RATE`, `CLICK_RATE`, `CONVERT_RATE`, plus a
`DUPLICATE_PCT` (to exercise idempotency) and a `MIN_DELAY_MS`–`MAX_DELAY_MS` jitter window (to
exercise out-of-order arrival). Each stage fires an asynchronous `POST /receipts`.

Callbacks themselves are resilient: `postReceipt` ([callback.ts](../apps/channel-stub/src/callback.ts))
retries up to `MAX_RETRIES = 8`× with capped exponential backoff (`BASE_BACKOFF_MS = 250` → … →
`MAX_BACKOFF_MS = 8000`, a ~30s total window) and, on final failure, logs and drops — the stub must
never crash or block other sends because the CRM is briefly unreachable. The window is deliberately
sized to outlast a CRM free-dyno cold start, so a callback firing while the CRM wakes isn't dropped
(a dropped `DELIVERED` would later get reconciled to `FAILED`).

When `CALLBACK_HMAC_SECRET` is configured on **both** services, each receipt POST is signed with an
`x-signature` header — an HMAC-SHA256 over the exact request body — and crm-api's
`ReceiptSignatureGuard` ([receipt-signature.guard.ts](../apps/crm-api/src/receipts/receipt-signature.guard.ts))
verifies it (`401` on a missing/invalid signature). An empty secret (the default) leaves callbacks
unsigned and is fully backward-compatible.

## 5. Receipts: idempotent, arrival-order-independent

`POST /receipts` ([receipts.controller.ts](../apps/crm-api/src/receipts/receipts.controller.ts)) ingests
one lifecycle callback (`delivered / opened / read / clicked / failed / converted`). It is exempt from
the global rate limiter (`@SkipThrottle`) so the stub's bursty callbacks during a send are never
throttled; it relies on the optional HMAC signature for auth instead. Two invariants make this robust:

### Idempotency

Every receipt carries an `idempotencyKey`. The append-only `CommunicationEvent` table has a unique
constraint on it. A duplicate callback (the stub deliberately sends some) is a **successful no-op** —
the endpoint always returns `200`.

### Status is a projection, not arrival order

`Communication.status` is **never** computed from the order callbacks arrive in. It is a projection
over the `CommunicationEvent` log by **type precedence on `occurredAt`**. So if `opened` arrives
*before* `delivered` (jitter makes this happen), the projected status is still correct. The event log
is the source of truth; the status column and timestamps are a cache of it.

### Conversions & revenue attribution

A `CONVERTED` receipt may carry a conversion payload (`externalId`, `amount`, `currency`, `orderedAt`).
The handler counts the conversion and, when the payload is valid, attributes the order's revenue to the
communication (last-touch) and rolls it into `campaign.attributedRevenue`. A malformed payload still
counts the conversion but cannot attribute revenue — graceful degradation rather than a hard failure.

### The projection cache

Per-campaign counters (`sentCount`, `deliveredCount`, `openedCount`, …, `attributedRevenue`) are kept
on the `Campaign` row so the dashboard reads are cheap. They are a **cache** — the event log can
rebuild them — maintained transactionally as receipts land.

## 6. The reconcile sweep

Receipts can be dropped (the stub gives up after retries) or a projection can drift under rare races.
A periodic **reconcile sweep** (`RECONCILE_INTERVAL_MS`, in-process in crm-api;
[reconcile.service.ts](../apps/crm-api/src/receipts/reconcile.service.ts)) heals three failure modes:
it **re-projects** any comm whose stored status drifted behind its events (never downgrading); it
**expires** a comm stuck at `SENT` past `RECEIPT_TIMEOUT_MS` (10 min) — whose in-memory callbacks were
lost to a stub restart — by appending a synthetic `FAILED` event; and once no comm is in-flight it
**recomputes** the receipt-owned campaign counters from the event sets and flips the campaign to
`COMPLETED`. This is the self-healing backstop that keeps stats eventually-consistent.

## 7. Testing the loop under stress

`tools/load` ([tools/load/README.md](../tools/load/README.md)) is a load + chaos harness that pushes N
communications through launch → stub → receipts and asserts the loop's invariants hold under volume and
induced chaos (duplicates, delays, failures). Run it with `pnpm load`.

## Configuration knobs

| Service | Env | Meaning |
| --- | --- | --- |
| crm-api | `WORKER_CONCURRENCY` | rows claimed per pass |
| crm-api | `WORKER_MAX_ATTEMPTS` | permanent-failure attempts before dead-letter |
| crm-api | `SEND_RATE_PER_SEC` | per-worker send spacing |
| crm-api | `RECONCILE_INTERVAL_MS` | reconcile sweep cadence |
| channel-stub | `DELIVERED_RATE` / `OPEN_RATE` / `CLICK_RATE` / `CONVERT_RATE` | funnel probabilities |
| channel-stub | `DUPLICATE_PCT` | % of callbacks duplicated (idempotency test) |
| channel-stub | `MIN_DELAY_MS` / `MAX_DELAY_MS` | callback jitter window (ordering test) |
