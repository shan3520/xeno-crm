# @xeno/channel-stub

A self-contained Fastify service that **simulates the full message lifecycle** for the Xeno CRM. It is the only "provider" in the system — no real messaging integration, no database, no Redis, no broker.

## How it works

1. **CRM worker** sends a communication via `POST /send`
2. **Stub** returns a `providerMessageId` immediately (never blocks)
3. **Stub** schedules a causally-ordered chain of lifecycle events on independent in-memory timers
4. **Each event** is POSTed back to the CRM's receipt endpoint (`CRM_RECEIPT_URL`) as a `ReceiptEvent`

### Event chain

```
SENT → DELIVERED (prob DELIVERED_RATE)
     → FAILED (if not delivered — chain stops)
     → OPENED  (prob OPEN_RATE)          ← skipped for SMS
     → READ    (prob 0.7 of opened)      ← skipped for SMS
     → CLICKED (prob CLICK_RATE of read)
     → CONVERTED (prob CONVERT_RATE of clicked)
```

**Channel realism**: SMS has no open-tracking pixel, so `OPENED` and `READ` are never emitted. `CLICKED` follows `DELIVERED` directly for SMS. EMAIL, WHATSAPP, and RCS run the full chain.

### `occurredAt` vs arrival order

Each event carries an `occurredAt` timestamp — the **simulated channel time** the event happened. These are always causally ordered (SENT < DELIVERED < OPENED < …).

However, each event fires on its own **independent jittered timer**, so events may arrive at the CRM in a different order than their `occurredAt` values. This is deliberate — it exercises the CRM's arrival-order-independent status projection.

### Duplicates

With probability `DUPLICATE_PCT`, an event is delivered to the CRM **twice** with the **same `idempotencyKey`**. The CRM must deduplicate on this key.

### `CONVERTED` payload

`CONVERTED` events carry a synthetic order payload:
```json
{
  "externalId": "ord_a1b2c3d4",
  "amount": 127.50,
  "currency": "USD",
  "orderedAt": "2026-06-10T12:34:56.789Z"
}
```

### Resilience

If a callback POST to the CRM fails (non-2xx or network error), the stub retries up to **8 times** with capped exponential backoff (250ms → 500ms → 1s → 2s → 4s → 8s → 8s → 8s, capped at 8s), then drops the event. The ~30s total window is sized to outlast a CRM free-dyno cold start (~17–40s to wake), so a callback firing while the CRM boots isn't dropped — a dropped DELIVERED would otherwise get reconciled to FAILED. A CRM being temporarily down will never crash the stub or block other sends.

### Signed callbacks (optional)

When `CALLBACK_HMAC_SECRET` is set here **and** to the same value on crm-api, each receipt POST is signed with an `x-signature` header — an HMAC-SHA256 over the exact request body — which crm-api's `ReceiptSignatureGuard` verifies (rejecting missing/invalid signatures with `401`). An empty secret (the default) leaves callbacks unsigned and is fully backward-compatible.

## Environment variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | int | `3002` | Server listen port |
| `CRM_RECEIPT_URL` | URL | — | **Required.** CRM receipt callback endpoint |
| `CALLBACK_HMAC_SECRET` | string | `""` (off) | Shared secret; when set (matching crm-api's), each receipt POST is HMAC-SHA256-signed via an `x-signature` header. Empty = unsigned |
| `DELIVERED_RATE` | 0–1 | `0.92` | Probability of SENT → DELIVERED |
| `OPEN_RATE` | 0–1 | `0.55` | Probability of DELIVERED → OPENED |
| `CLICK_RATE` | 0–1 | `0.30` | Probability of READ → CLICKED (or DELIVERED → CLICKED for SMS) |
| `CONVERT_RATE` | 0–1 | `0.15` | Probability of CLICKED → CONVERTED |
| `DUPLICATE_PCT` | 0–1 | `0.05` | Probability that an event is POSTed twice |
| `MIN_DELAY_MS` | int ≥ 0 | `500` | Minimum jitter delay (ms) for timers |
| `MAX_DELAY_MS` | int > MIN | `30000` | Maximum jitter delay (ms) for timers |

Copy `.env.example` to `.env` for local development, or set variables in your environment.

## API

### `GET /health`

```json
{ "status": "ok", "service": "channel-stub" }
```

### `POST /send`

**Request:**
```json
{
  "communicationId": "cm1234abc",
  "channel": "EMAIL",
  "recipientAddress": "user@example.com",
  "renderedMessage": "Hello! Check out our new collection."
}
```

**Response (200):**
```json
{
  "providerMessageId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Running locally

```bash
# From the repo root
pnpm --filter @xeno/channel-stub dev
```

## Known tradeoffs

- **In-memory timers**: All scheduled lifecycle events live in `setTimeout` — if the process restarts, in-flight schedules are lost. This is intentional: the stub is a simulation aid, not a durable queue. A restart simply means some communications won't receive their remaining lifecycle events.
- **No persistence**: The stub has no database or state file. Every run starts fresh.
- **Dropped callbacks**: If the CRM is unreachable after retries, the event is logged and dropped. The CRM's idempotent design means this is safe to retry manually (e.g., by re-sending the communication).
