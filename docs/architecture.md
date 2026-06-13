# Architecture

## Overview

Looms is three independently-deployable services that communicate over HTTP and meet only at the
frozen contracts in `@xeno/shared`. Each service has one clear job.

| Service | Stack | Responsibility |
| --- | --- | --- |
| **web** | Next.js 15 (App Router) | Console UI + AI orchestration. The only place the LLM is called (`/api/chat`). Talks to crm-api over REST. |
| **crm-api** | NestJS + Prisma | The domain + system of record. Ingest, customers, orders, segments, campaigns, the **Postgres-backed send queue + in-process worker**, and the `/receipts` callback ingestion. The **sole writer** to the database. |
| **channel-stub** | Fastify | A fake messaging provider. Accepts `POST /send` and simulates the full message lifecycle, firing **asynchronous, jittered callbacks** back to crm-api `/receipts`. |
| **Postgres (Neon)** | — | Single database owned by crm-api. |

```
  Browser ──► web (Next.js, Vercel)
              │  console UI + AI orchestration (/api/chat)
              │
     REST     ▼                          POST /send
  ┌────────────────────┐ ──────────────► ┌───────────────────────┐
  │  crm-api (NestJS)  │                  │ channel-stub (Fastify) │
  │  domain + Postgres │                  │ simulates the lifecycle│
  │  queue + worker +  │ ◄────────────────│ fires jittered async   │
  │  /receipts         │   POST /receipts │ callbacks              │
  └─────────┬──────────┘                  └───────────────────────┘
            │
            ▼
     Postgres (Neon)
```

Local ports: **web 3000 · crm-api 3001 · channel-stub 3002**.

## Why this split

- **The channel-stub is a separate service on purpose.** The brief asks us to model the *full
  lifecycle* of a communication through a stubbed provider with asynchronous callbacks. Making it a
  real second service (not an in-process mock) forces the same concerns a real provider would: a
  network boundary, out-of-order and duplicate callbacks, retries, and partial failure. See
  [send-loop.md](send-loop.md).
- **The AI lives only in web.** The LLM is an orchestration concern, not a domain concern. Keeping it
  in the Next.js server route means the domain service (crm-api) stays a clean, testable REST API
  with no model dependency, and the AI can never write to the database directly — it can only call
  crm-api like any other client.
- **crm-api is the single writer.** One service owns the schema, migrations, the queue, the worker,
  and receipt ingestion. There is no separate worker dyno — the worker and the reconcile sweep run
  **in-process** inside crm-api (a deliberate scope choice; see the
  [Tradeoffs section](../README.md#tradeoffs-and-scale-assumptions)).

## The two primary flows

### 1. Campaign authoring (AI, synchronous)

```
marketer types intent
      │
      ▼
web /api/chat ── streamText (Vercel AI SDK) with 3 tools ──► LLM (Groq/NVIDIA/Gemini, fallback chain)
      │                                                          │
      │   tool: generate_segment_rule ──► crm-api POST /segments/preview (validate+compile+count+sample)
      │   tool: draft_message         ──► channel-appropriate copy with {{tokens}}
      │   tool: narrate_results       ──► crm-api GET /campaigns/:id/stats, then explain
      ▼
editable artifact cards stream back to the console (segment / message / launch / results)
```

The AI never persists anything. Each tool returns a **validated structured object** (Zod, against
`@xeno/shared`); the marketer edits it in the UI; only an explicit user action (Launch) writes to the
DB via crm-api. Full detail in [ai-native.md](ai-native.md).

### 2. Send & track (asynchronous, callback-driven)

```
POST /campaigns/:id/launch
   freezes the audience → writes N QUEUED Communications → flips campaign to SENDING
      │
      ▼
in-process worker (claim loop, FOR UPDATE SKIP LOCKED + lease + rate limit)
      │  POST /send ─────────────────────────────────────────► channel-stub
      │                                                            │ schedules a jittered
      │                                                            │ lifecycle chain on timers
      ▼                                                            ▼
  Communication.status = SENT                          POST /receipts (delivered, opened,
                                                          read, clicked, converted, failed)
      │                                                            │
      ▼                                                            ▼
                          crm-api ingests receipts IDEMPOTENTLY → appends CommunicationEvent
                          (append-only log = source of truth) → projects Communication.status
                          + campaign counters (arrival-order-independent)
```

This is the system's centre of gravity. The deep-dive — queue mechanics, lease/backoff/dead-letter,
idempotency, the projection, and the reconcile sweep — is in **[send-loop.md](send-loop.md)**.

## Key design principles

- **Append-only event log is the source of truth.** `CommunicationEvent` rows are never updated.
  `Communication.status` and the campaign counters are *projections* over those events — computed by
  type precedence on `occurredAt`, so they are **independent of callback arrival order**.
- **Idempotency everywhere it matters.** Receipts dedupe on `idempotencyKey`; a duplicate callback is
  a successful no-op. Launch is guarded so a campaign can't be double-launched.
- **The DB row is the work item.** No Redis, no BullMQ. The `Communication` row carries its own queue
  state (`attemptCount`, `nextAttemptAt`, `lockedAt`, `lockedBy`) and is claimed with
  `SELECT … FOR UPDATE SKIP LOCKED`. This keeps the architecture to one datastore.
- **Frozen shared contracts.** `@xeno/shared` holds the Zod schemas, the segment DSL, the enums, and
  the DTO types. Both the AI tools and the crm-api DTOs validate against the *same* schemas, so the
  AI output and the API contract can never drift.
- **Field whitelist for AI-generated rules.** The segment DSL only allows a fixed set of fields and
  operators; the compiler maps each to a concrete column/join and never accepts a raw field. The AI
  cannot produce a rule that reaches an unintended column.

## Scale assumptions & where it would change

This is built for a **demo-scale single workspace** (thousands of customers, tens of thousands of
orders), and the tradeoffs are chosen for that. The reasoning — and "I'd do X at scale but did Y for
this scope" — is laid out explicitly in the
**[Tradeoffs section of the README](../README.md#tradeoffs-and-scale-assumptions)**. In short:

- The in-process worker and `SELECT … FOR UPDATE SKIP LOCKED` scale fine to a few workers / moderate
  volume; at high volume you'd move to a dedicated worker tier and/or a purpose-built queue.
- Campaign counters are a denormalized projection cache; the append-only event log lets you rebuild
  them at any time, and a reconcile sweep repairs drift.
- Single seeded workspace, no auth — a conscious scope cut (see tradeoffs).

## Resilience touches worth knowing

- **Worker:** lease (`lockedAt`/`lockedBy`) so a crashed worker's in-flight rows become reclaimable;
  exponential backoff with jitter; dead-letter after max attempts; **transient failures
  (stub 429/5xx/cold-start) retry without consuming the dead-letter budget**.
- **AI route:** a config-driven provider fallback chain with a **per-provider timeout** — a slow or
  unavailable provider fails over to the next instead of stalling the turn; rate limits degrade to a
  typed "retry" surface rather than crashing.
- **Channel-stub:** callbacks retry with backoff and never crash the stub if the CRM is briefly
  unreachable.
- **Free-tier ops:** GitHub Actions cron pings both `/health` URLs to mitigate Render cold starts.
