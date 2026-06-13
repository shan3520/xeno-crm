# Data Model

The single source of truth is [`apps/crm-api/prisma/schema.prisma`](../apps/crm-api/prisma/schema.prisma).
Postgres on Neon. Money is `Decimal`, timestamps are `timestamptz` (UTC), IDs are `cuid`. The enums
mirror `@xeno/shared` so the API contracts and the DB never drift.

## Entity map

```
Workspace 1──┬──* Customer 1──* Order 1──* OrderItem
             │                    │
             │                    └─(attributedCommunication, last-touch)─┐
             ├──* Segment                                                 │
             ├──* Campaign 1──* Communication 1──* CommunicationEvent     │
             │                       └────────────────────────────────────┘
             ├──* ChatThread 1──* ChatMessage
             └──* AiTaskLog
```

Everything hangs off a single **Workspace** (one seeded workspace — no auth, a conscious scope cut;
see the [Tradeoffs section](../README.md#tradeoffs-and-scale-assumptions)).

## Core domain

### Customer
Shopper identity + **denormalized order rollups** the segment engine reads directly:
`totalSpend`, `orderCount`, `firstOrderAt`, `lastOrderAt`. Free-form `attributes` JSON holds things
like `city`, `tier`, `tags` that the segment DSL can target. Unique on `(workspaceId, externalId)` so
ingest is an idempotent upsert. Indexed on `(workspaceId, email)` and `(workspaceId, lastOrderAt)`.

### Order / OrderItem
An order belongs to a customer and has line items (`productName`, `sku`, `category`, `quantity`,
`unitPrice`). `OrderItem.category` is indexed because the segment DSL can target it
(`order_item.category eq sneakers`). `Order.attributedCommunicationId` is the **last-touch
attribution** link — the communication credited with driving the order (unique, so one order maps to at
most one crediting communication).

> **Why rollups?** Storing `totalSpend`/`orderCount`/`lastOrderAt` on the customer lets the segment
> compiler answer most audience questions without aggregating the orders table on every preview. They
> are recomputed on order ingest. At scale you'd maintain these incrementally or in a read model; for
> this scope, recompute-on-ingest is simple and correct.

## Segmentation

### Segment
A saved audience rule: `name`, `description`, `definition` (the segment DSL JSON tree), and `origin`
(`AI` | `MANUAL`). Caches `lastEvaluatedCount` / `lastEvaluatedAt`. The DSL shape itself is defined and
validated in `@xeno/shared` and compiled to SQL in crm-api against a **field whitelist** — see
[ai-native.md](ai-native.md#the-segment-dsl).

## Campaigns & the send loop

### Campaign
A send. Holds the `goal`, a snapshot `segmentId`, the `channel`, the `messageTemplate` (with
`{{tokens}}`), `status` (`DRAFT → LAUNCHING → SENDING → COMPLETED`/`FAILED`), and `audienceSize`.

It also carries the **projection-cache counters**: `queuedCount`, `sentCount`, `deliveredCount`,
`failedCount`, `openedCount`, `readCount`, `clickedCount`, `convertedCount`, and `attributedRevenue`.
These are denormalized for cheap dashboard reads and kept in sync by the receipt handler + reconcile
sweep. They are a *cache* — the event log can always rebuild them.

### Communication
One message to one customer — **and the queue work item**. Beyond the obvious (`channel`,
`recipientAddress`, `renderedMessage`, `status`, `providerMessageId`), it carries:

- **Queue state:** `attemptCount`, `nextAttemptAt`, `lockedAt`, `lockedBy` — claimed via
  `FOR UPDATE SKIP LOCKED` (see [send-loop.md](send-loop.md)).
- **Projected status timestamps:** `sentAt`, `deliveredAt`, `openedAt`, `readAt`, `clickedAt`,
  `failedAt`, `convertedAt`, `failureReason` — a cache of the event log, *not* authoritative.

Indexed on `(campaignId, status)`, `providerMessageId`, and `(status, nextAttemptAt)` (the claim
predicate).

### CommunicationEvent — the source of truth
An **append-only** log of what the channel reported: `type` (`SENT`/`DELIVERED`/`OPENED`/`READ`/
`CLICKED`/`FAILED`/`CONVERTED`), `occurredAt` (when it happened, per the provider), `receivedAt` (when
we ingested it), and `payload`. The unique **`idempotencyKey`** is what makes receipt ingestion
idempotent.

> **This table is the system's spine.** `Communication.status` and the campaign counters are
> *projections* over these rows by type precedence on `occurredAt` — which is why the loop is
> **independent of callback arrival order**. Rows here are never updated.

## AI & chat

- **ChatThread / ChatMessage** — persisted conversation history (`role` = `USER`/`ASSISTANT`/`TOOL`,
  `content` JSON). Persistence is best-effort and never blocks a chat turn.
- **AiTaskLog** — an audit row for every AI tool call: `kind` (`SEGMENT_RULE`/`MESSAGE_DRAFT`/
  `RESULTS_NARRATIVE`), `model`, `inputTokens`/`outputTokens`, `latencyMs`, and the `input`/`output`.
  Useful for cost/latency observability and for showing exactly what the AI produced.

## Modelling decisions worth calling out

1. **Append-only event log + projection cache.** Separating "what happened" (immutable events) from
   "current state" (derived columns) gives order-independence, idempotency, and the ability to rebuild
   stats — the right shape for an engagement-tracking system.
2. **The Communication row carries its own queue state.** One datastore, no external queue. The
   tradeoff (and where it would change at scale) is in the
   [Tradeoffs section](../README.md#tradeoffs-and-scale-assumptions).
3. **Denormalized customer rollups + campaign counters.** Read-optimized caches with a clear rebuild
   path, rather than aggregating on every request.
4. **Last-touch attribution** via `Order.attributedCommunicationId` — simple, explainable, and enough
   to demonstrate "this order came from this communication."
5. **`externalId` everywhere** (customers, orders) → ingest is an idempotent upsert keyed on the
   source system's id.
