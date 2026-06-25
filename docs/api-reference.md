# API Reference

Three services expose HTTP APIs. Request/response shapes are validated by Zod schemas in
[`@xeno/shared`](../packages/shared/src) (the same schemas the AI tools use), so this reference and the
running contract cannot drift.

Base URLs (local): **crm-api** `http://localhost:3001` · **channel-stub** `http://localhost:3002` ·
**web** `http://localhost:3000`.

---

## crm-api (NestJS) — the domain & system of record

Errors share one envelope: `{ statusCode, error, message, requestId }` (5xx messages are genericized
to `"Internal server error"`; 4xx keep their specific message). A per-IP rate limit (200 requests / 60s,
tunable via `RATE_LIMIT_MAX` / `RATE_LIMIT_TTL_MS`) returns **`429`** when exceeded; `/health` and
`/receipts` are exempt.

### Health

`GET /health` → `{ "status": "ok", "service": "crm-api" }` (exempt from rate limiting).

### Ingest

**`POST /ingest/customers`** — bulk **upsert** by `externalId`. Body:

```jsonc
{
  "customers": [
    {
      "externalId": "C-1001",
      "firstName": "Leone",
      "lastName": "Heidenreich",
      "email": "leone@example.com",
      "phone": "+91...",                 // optional
      "attributes": { "city": "Mumbai", "tier": "VIP", "tags": ["sneakerhead"] },
      "orderStats": {                     // optional precomputed rollups
        "totalSpend": 12400, "orderCount": 7,
        "firstOrderAt": "2025-01-02T...Z", "lastOrderAt": "2026-05-30T...Z"
      }
    }
  ]
}
```
→ `200 { "created": number, "updated": number }`

**`POST /ingest/orders`** — bulk upsert orders + line items, then recompute touched customers'
rollups. Body:

```jsonc
{
  "orders": [
    {
      "externalId": "O-5001",
      "customerExternalId": "C-1001",
      "totalAmount": 3499.0,
      "currency": "INR",                  // 3-letter
      "status": "paid",
      "orderedAt": "2026-05-30T10:00:00Z",
      "items": [
        { "productName": "Runner X", "sku": "RX-42", "category": "sneakers", "quantity": 1, "unitPrice": 3499.0 }
      ]
    }
  ]
}
```
→ `200 { "created": number, "updated": number, "customersTouched": number }`

### Customers & orders

- `GET /customers` — list customers (workspace-scoped).
- `GET /customers/:id` — one customer with rollups.
- `GET /orders` — list orders.

### Segments

**`POST /segments/preview`** — validate + compile + count + sample, **no persistence**. Body is the
segment DSL definition:

```jsonc
{
  "definition": {
    "op": "AND",
    "conditions": [
      { "field": "order_item.category", "operator": "eq", "value": "sneakers" },
      { "field": "customer.last_order_at", "operator": "older_than_days", "value": 60 }
    ]
  }
}
```
→ `200 { "count": number, "sample": Customer[] }`. (The DSL fields/operators are documented in
[ai-native.md](ai-native.md#the-segment-dsl). Non-whitelisted fields/operators, operator/value
mismatches, or a tree exceeding the complexity caps — depth > 12 or > 500 total nodes — are rejected
here with **`400`**.)

- **`POST /segments`** — persist a segment (`{ name, description?, definition, origin? }`), caching its
  evaluated count.
- `GET /segments` — list. `GET /segments/:id` — one. `GET /segments/:id/members` — paginated compiled
  audience.

### Campaigns

**`POST /campaigns`** — create a `DRAFT` (counters 0). Body (`CampaignDraft`):

```jsonc
{
  "name": "Lapsed sneaker buyers",
  "goal": "Win back customers who bought sneakers 60+ days ago",
  "segmentId": "seg_...",          // either a saved segment id…
  "definition": { /* …or an inline segment DSL */ },
  "channel": "EMAIL",              // EMAIL | SMS | WHATSAPP | RCS
  "messageTemplate": "We've missed you, {{first_name}}! …"
}
```
→ `CampaignResponse` (status `DRAFT`).

- `GET /campaigns` — list with status + counters. `GET /campaigns/:id` — one.
- **`POST /campaigns/:id/launch`** — freeze the audience, write `QUEUED` communications, flip to
  `SENDING`. Does **not** send. → `LaunchResponse` (a `CampaignResponse` plus `skippedNoAddress` —
  audience members dropped for lacking an address on the channel; the queued count lives in
  `counters.queued`). Returns **`409`** if the campaign isn't launchable (e.g. already `SENDING`).

### Analytics

- **`GET /campaigns/:id/stats`** — `{ campaign, funnel, rates, attributedRevenue, failureBreakdown,
  timeline }`: the funnel (`queued/sent/delivered/opened/read/clicked/converted/failed`), derived
  `rates` (`deliveryRate/openRate/clickRate/conversionRate`), the `attributedRevenue` (Decimal string),
  a `failureBreakdown` (`{ reason, count }[]`), and a `timeline` of time buckets.
- **`GET /analytics/overview`** — workspace rollup across all campaigns (totals, delivery/open/click
  rates, revenue) for the dashboard.

### Receipts (channel-stub → crm-api callback)

**`POST /receipts`** — ingest one lifecycle callback. **Idempotent** on `idempotencyKey`; always
returns `200` (a duplicate is a successful no-op). Body (`ReceiptEvent`):

```jsonc
{
  "communicationId": "comm_...",
  "providerMessageId": "uuid-from-/send",
  "type": "DELIVERED",            // SENT|DELIVERED|OPENED|READ|CLICKED|FAILED|CONVERTED
  "occurredAt": "2026-06-13T10:00:01Z",
  "idempotencyKey": "comm_...:DELIVERED:1",
  "payload": {                    // e.g. for CONVERTED:
    "externalId": "O-9001", "amount": 3499, "currency": "INR", "orderedAt": "...Z"
  }
}
```
→ `200 { "ok": true, "duplicate": boolean, "status"?: string }`

When `CALLBACK_HMAC_SECRET` is set, requests must carry a valid `x-signature` HMAC-SHA256 over the
raw body; a missing/invalid signature is rejected with **`401`**. The secret defaults to empty, in
which case verification is off and all callbacks are accepted (backward compatible). This endpoint is
exempt from rate limiting so the stub's callback burst is never throttled.

### Chat persistence (used by web `/api/chat`)

- `POST /chat-threads` → `{ id }` — start a thread.
- `GET /chat-threads/:id` — fetch a thread + messages.
- `POST /chat-threads/:id/messages` — append messages (`{ role, content }`).
- `POST /ai-task-logs` — write an AI audit row (`kind`, `model`, tokens, `latencyMs`, `input`,
  `output`).

---

## channel-stub (Fastify) — the simulated provider

### Health

`GET /health` → `{ "status": "ok", "service": "channel-stub" }`

### Send

**`POST /send`** — accept a send and schedule its simulated lifecycle on jittered timers. Returns
**immediately**; never delivers anything real. Body:

```jsonc
{
  "communicationId": "comm_...",
  "channel": "EMAIL",
  "recipientAddress": "leone@example.com",
  "renderedMessage": "We've missed you, Leone! …"
}
```
→ `200 { "providerMessageId": "uuid" }` · `400` on invalid body.

The stub then asynchronously `POST`s lifecycle events to crm-api `/receipts` (see
[send-loop.md](send-loop.md)).

---

## web (Next.js) — AI orchestration

**`POST /api/chat`** — the conversational console endpoint. Body:

```jsonc
{ "messages": [ { "role": "user", "content": "win back lapsed sneaker buyers" } ], "threadId": "..." }
```
Streams back a Vercel AI SDK **UI message stream** — assistant text plus tool results
(`generate_segment_rule` / `draft_message` / `narrate_results`) that the console renders as editable
artifact cards. Returns the thread id in the `x-thread-id` header. Rate-limit / timeout conditions are
surfaced as a typed, retryable error part rather than a hard failure. Details in
[ai-native.md](ai-native.md).

This is the **only** endpoint that calls an LLM. The AI never writes to the database — it calls crm-api
like any other client, and all writes happen through explicit user actions.
