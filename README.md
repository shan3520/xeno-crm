# Looms · AI-Native Mini CRM

> A conversational campaign console for D2C / retail brands. A marketer states intent in plain
> English; the AI proposes **structured, editable artifacts** — an auditable audience segment, a
> per-channel message draft, and a results narrative grounded in real stats. The marketer reviews
> and approves; the system simulates the full message lifecycle through a separate channel service
> and tracks **delivered → opened → read → clicked → converted**.

Built for the **Xeno Engineering Take-Home — "Build an AI-Native Mini CRM for Reaching Shoppers."**

| | |
| --- | --- |
| 🌐 **Live app** | https://xeno-crm-web.vercel.app |
| 🩺 crm-api health | https://xeno-crm-api.onrender.com/health |
| 🩺 channel-stub health | https://xeno-channel-stub.onrender.com/health |

> ⚠️ The backend runs on **free tiers** (Render + Neon) that sleep when idle. The first request
> after a cold period can take ~50s while services wake. Hit the two health URLs above once to warm
> them before demoing.

---

## The product bet

The brief was deliberately open. This build commits to one sharp point of view:

**The marketer talks; the AI proposes; the human approves; the system executes and measures.**

Every AI output is a **structured, auditable artifact the marketer can edit before anything sends** —
never a black box. A segment is an editable rule tree (not a frozen number), message copy is editable
with a live per-recipient preview, and the results read-out is grounded in fetched stats, never
invented. The AI is the *fast path to a first draft*; the human stays in control of what actually ships.

What this **is**: a marketing & engagement CRM, in Xeno's spirit.
What this is **not**: a sales/support CRM — no deals, pipelines, leads, or tickets.

## What it does

1. **Ingest** — customers + orders (with line items), stored in Postgres with denormalized rollups
   (total spend, order count, first/last order) the segment engine reads.
2. **Segment (AI)** — describe an audience in English → the AI emits a whitelisted **segment DSL**
   (a recursive AND/OR/NOT rule tree) that is validated, compiled to SQL, and previewed live
   (count + sample). The marketer can hand-edit the emitted rule and the count recomputes.
3. **Draft (AI)** — channel-appropriate copy (EMAIL/SMS/WHATSAPP/RCS) with `{{tokens}}`, shown with
   a real-customer preview.
4. **Launch & send** — the audience is frozen into `QUEUED` communications and drained by an
   in-process, **Postgres-backed queue worker** that calls the separate channel service.
5. **Track** — the channel service simulates the lifecycle and fires **asynchronous callbacks**; the
   CRM ingests them idempotently and projects per-communication status + campaign funnel stats
   (sent / delivered / opened / read / clicked / converted + attributed revenue).
6. **Narrate (AI)** — explain how a campaign performed, grounded in the real numbers.

## Architecture at a glance

Three deployable services meet only at the frozen `@xeno/shared` contracts:

```
  Browser ──► web (Next.js, Vercel)
              │  console UI + AI orchestration (/api/chat)
              │
     REST     ▼                          POST /send
  ┌────────────────────┐ ──────────────► ┌──────────────────────┐
  │  crm-api (NestJS)  │                  │ channel-stub (Fastify)│
  │  domain + Postgres │                  │ simulates the message │
  │  queue + worker +  │ ◄────────────────│ lifecycle, fires      │
  │  /receipts         │   POST /receipts │ jittered async callbacks│
  └─────────┬──────────┘   (delivered,    └──────────────────────┘
            │               opened, …,
            ▼               converted)
     Postgres (Neon)
```

The **two-service, callback-driven send loop is the heart of the system** — and where most of the
system-design thinking lives (volume, ordering, retries, failures, idempotency). It gets its own
deep-dive: **[docs/send-loop.md](docs/send-loop.md)**.

## Tech stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Web:** Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, TanStack Query, Recharts
- **AI:** Vercel AI SDK with a config-driven multi-provider fallback chain (Groq / NVIDIA NIM /
  Gemini), running server-side in the Next.js `/api/chat` route
- **CRM API:** NestJS, Prisma, nestjs-zod; **Postgres-backed send queue** + in-process worker
- **Channel service:** Fastify, in-memory jittered callback timers
- **DB:** PostgreSQL (Neon)
- **Deploy:** Vercel (web) + Render ×2 (crm-api, channel-stub) + Neon (Postgres), with a GitHub
  Actions cron pinging `/health` to defeat free-tier cold starts

No real messaging provider is integrated — the channel-stub is the only "provider," by design.

## Repository layout

```
xeno-crm/
├── apps/
│   ├── web/            # Next.js: console UI + AI orchestration (/api/chat)
│   ├── crm-api/        # NestJS: domain, Postgres queue + in-process worker, /receipts
│   │   └── prisma/     # schema.prisma, migrations, seed.ts
│   └── channel-stub/   # Fastify: /send + lifecycle simulator + async callbacks
├── packages/
│   └── shared/         # Zod schemas, segment DSL, enums, DTO types (the frozen contracts)
├── tools/load/         # load + chaos harness for the callback loop
├── docs/               # all documentation (see below)
└── README.md           # you are here
```

## Documentation

| Doc | What's inside |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | System design, the three services, request flows, scale assumptions |
| [docs/send-loop.md](docs/send-loop.md) | **The core:** Postgres queue, worker, channel lifecycle, idempotent receipts, projection |
| [docs/data-model.md](docs/data-model.md) | Entities, relationships, and the key modelling decisions |
| [docs/api-reference.md](docs/api-reference.md) | Every HTTP endpoint across all three services |
| [docs/ai-native.md](docs/ai-native.md) | The AI design: tools, the segment DSL, the provider fallback chain, guardrails |
| [docs/local-development.md](docs/local-development.md) | Run it locally |
| [docs/deployment.md](docs/deployment.md) | Deploy to Vercel + Render + Neon |
| [Tradeoffs](#tradeoffs-and-scale-assumptions) *(below)* | **Explicit tradeoffs & scale assumptions** — what was chosen, and what was consciously left out |
| [docs/scenarios.md](docs/scenarios.md) | Scripted demo walkthroughs |

## Quickstart (local)

```bash
pnpm install
pnpm db:migrate        # apply Prisma migrations
pnpm db:seed           # faker-based realistic data (~2k customers, ~6k orders)
pnpm dev               # web :3000 · crm-api :3001 · channel-stub :3002
```

You'll need a Postgres database (`DATABASE_URL`) and at least one AI provider key. See
[docs/local-development.md](docs/local-development.md) for the full env matrix and per-app `.env.example` files.

## Commands

| Command | Does |
| --- | --- |
| `pnpm dev` | Run all three services (Turborepo) |
| `pnpm lint && pnpm typecheck && pnpm test` | Quality gate |
| `pnpm db:migrate` / `db:seed` / `db:studio` | Prisma migrate / seed / studio |
| `pnpm reconcile` | Run the reconcile sweep once |
| `pnpm load` | Push N communications through launch → stub → receipts (load + chaos harness) |

## Tradeoffs and scale assumptions

Built for **demo scale** — a single workspace, thousands of customers, tens of thousands of orders, all
synthetic — and every choice is made for that scope. Read each as *"shipped Y for this scope; would do
X at scale."*

**Cost — the whole stack runs at $0.**
- **Hosting: Vercel (web) + Render ×2 + Neon (Postgres)** — all free, no card on load-bearing pieces.
  Tradeoff: Render free services cold-start after ~15 min idle and the stub's in-memory timers are lost
  on restart. Mitigation: a GitHub Actions cron pings `/health` during the eval window. *At scale:*
  always-on instances + durable callback scheduling.
- **Neon free Postgres (scale-to-zero, 0.5 GB)** — ample for synthetic data; sub-second cold start.
  *At scale:* paid autoscaling Neon, read replicas, dedicated pooling.
- **Free-tier LLMs behind a fallback chain** (Groq / NVIDIA NIM / Gemini) — no budget; the
  structured-output design is provider-agnostic, so the chain is *config* (`AI_PROVIDER_ORDER`), not
  code. Rate limits / slowness degrade to a typed "retry" surface and fail over to the next provider.
  All prompt data is synthetic, so free tiers are acceptable. *At scale:* paid quota / Vertex AI (no
  training on inputs); the provider abstraction is already in place.
- **Load test (5k) run locally, not on free hosting** — the correctness invariants (idempotency,
  monotonic status, counter == event aggregate) hold at any volume and are what matter. *At scale:* the
  same loop on provisioned compute.

**Product scope — depth over breadth.**
- **No manual segment query-builder** — the UI only edits the AI-emitted DSL rule. The bet: NL + an
  editable, auditable rule beats a query-builder for marketers and keeps the AI central. *At scale:* a
  power-user visual builder + a reusable segment library.
- **Three AI touchpoints** (segment rule, copy, results narrative) — the genuinely hard NL→structure
  translations. *At scale:* send-time optimization, channel selection, budget pacing, an autonomous
  multi-step agent with approvals.
- **Single brand persona ("Looms")** — a concrete demo lands better than an abstract multi-brand shell.
  *At scale:* full multi-brand catalog + per-brand config.

**Auth & tenancy.**
- **No auth, single seeded workspace** — out of scope, zero rubric value, saves days. *At scale:*
  Auth.js/Clerk, multi-tenant row isolation, RBAC, audit logging.

**Segmentation.**
- **Dynamic evaluation on read; audience frozen at launch** — correct and simple at this size.
  *At scale:* materialized membership, CDC/incremental updates, cached counts.
- **Field/operator whitelist + DSL→SQL compiler (no raw SQL from the model)** — safety + auditability
  for AI-generated queries. *At scale:* richer operators, query-cost limits, a generated-rule eval suite.

**The send / callback loop (the core).**
- **Append-only `CommunicationEvent` + status as a projection** (type precedence over `occurredAt`) —
  kept; this *is* the scalable design: arrival-order-independent, idempotent, replayable. *At scale:*
  event stream to Kafka, OLAP store (ClickHouse) for analytics.
- **Postgres-backed queue, not Redis/BullMQ** — the `Communication` row is the work item, claimed via
  `SELECT … FOR UPDATE SKIP LOCKED` with a lease, backoff, and dead-letter. Removes a dependency and is
  a cleaner system-design story. *At scale:* a dedicated jobs table or real broker (Kafka/SQS), DLQ +
  alerting, partitioned consumers, per-channel rate limits.
- **Worker in-process inside crm-api** — one fewer deployable on free hosting. *At scale:* a separate
  worker fleet with horizontal scaling + backpressure.
- **Channel stub: env-tunable probabilities, in-memory timers** — deterministic-ish demos, minimal
  stub. A restart drops in-flight schedules (acceptable for a stub). *At scale:* real providers behind
  an adapter; the stub becomes a test double.
- **Last-touch conversion attribution** via the `CONVERTED` callback — demonstrates "this order came
  from this comm." *At scale:* attribution windows, multi-touch models, holdouts.

**Two findings from the load harness (kept as evidence of rigor):**
- **Lost-update race in receipt projection — found, then fixed.** Under burst, concurrent callbacks for
  the same message did a read-modify-write with no row lock, so a late lower-status callback could
  overwrite a higher one (~2.4% of comms). Fix: `SELECT … FOR UPDATE` on the message as the first
  statement of the ingest transaction, serializing per-message projection. The append-only event log
  stayed correct throughout — only the cached status drifted, which is exactly why it was detectable
  and self-healable.
- **Receipt throughput vs. remote Postgres.** Receipts hold a pooled connection for a full round-trip;
  under burst the pool saturated. Mitigated via Neon's pooled endpoint + bounded worker concurrency.
  *At scale:* co-located DB, higher pool limits, async receipt ingestion.

**Analytics & consistency.**
- **Denormalized campaign counters maintained by the receipt handler** — fast dashboards; eventual
  consistency; the load harness asserts counters == event aggregates. *At scale:* stream processing /
  pre-aggregated rollups.
- **Live stats via polling while `SENDING`** — simplest reliable near-live updates. *At scale:*
  SSE/WebSocket push.

**Platform & compliance.**
- **Single-region deploy, managed Neon** — speed + $0. *At scale:* read replicas, multi-region,
  dedicated pooling.
- **No PII encryption / consent / suppression** — out of scope; all data synthetic. *At scale:*
  encryption at rest, consent + opt-out, suppression lists, GDPR/DPDP compliance.

## A note on AI-native development

This product was built with an AI-native workflow — the brief explicitly invites it.
[docs/ai-native.md](docs/ai-native.md) covers how AI is woven into the *product* itself: the chat
console, the structured editable artifacts the marketer approves, and the multi-provider fallback
chain. Every choice in this repo is my own and is explainable.
