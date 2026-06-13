# Local Development

## Prerequisites

- **Node ≥ 22** (see `.nvmrc` / `engines`)
- **pnpm 11** (`corepack enable` will provision the pinned version)
- A **PostgreSQL** database — a free [Neon](https://neon.tech) project or local Postgres
- At least one **AI provider API key** (Groq, NVIDIA NIM, or Gemini — any one works; more enable the
  fallback chain)

## Setup

```bash
git clone https://github.com/shan3520/xeno-crm.git
cd xeno-crm
pnpm install
```

Copy the per-app env templates and fill them in:

```bash
cp apps/web/.env.example          apps/web/.env.local
cp apps/crm-api/.env.example      apps/crm-api/.env
cp apps/channel-stub/.env.example apps/channel-stub/.env
```

Then migrate + seed the database and start everything:

```bash
pnpm db:migrate     # apply Prisma migrations
pnpm db:seed        # faker-based realistic data (~2k customers, ~6k orders) for the "Looms" brand
pnpm dev            # web :3000 · crm-api :3001 · channel-stub :3002 (Turborepo, parallel)
```

Open **http://localhost:3000** and drive a campaign: state intent → review the segment → review the
copy → launch → watch the funnel climb on the dashboard.

## Environment matrix

### `apps/web` (Next.js)

| Var | Purpose |
| --- | --- |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_MODEL_FAST` | Gemini provider (via `@ai-sdk/google`) |
| `GROQ_API_KEY`, `GROQ_MODEL` | Groq provider (tool-calling-capable model) |
| `NVIDIA_API_KEY`, `NVIDIA_MODEL` | NVIDIA NIM provider (OpenAI-compatible) |
| `AI_PROVIDER_ORDER` | comma-separated try order, e.g. `groq,nvidia,gemini` (default `groq,gemini`) |
| `AI_PROVIDER_TIMEOUT_MS` | per-provider response budget before failing over (default `22000`) |
| `CRM_API_URL` | server-side base URL for crm-api (used by `/api/chat`) |
| `NEXT_PUBLIC_CRM_API_URL` | browser base URL for crm-api (dashboard). Set both to the same value. |

Only the **server-side** `/api/chat` route calls an LLM — keys never reach the browser.

### `apps/crm-api` (NestJS)

| Var | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection (pooled in prod; see [deployment.md](deployment.md)) |
| `MIGRATE_DATABASE_URL` | optional, deploy-only — direct (non-pooled) URL for migrate/seed |
| `CHANNEL_STUB_URL` | base URL of the channel-stub (`/send`) |
| `PUBLIC_BASE_URL` | this service's own public base URL |
| `WEB_ORIGIN` | CORS allow-origin (the web app) |
| `WORKER_CONCURRENCY` | rows the worker claims per pass (default 10) |
| `WORKER_MAX_ATTEMPTS` | permanent-failure attempts before dead-letter (default 5) |
| `SEND_RATE_PER_SEC` | per-worker send spacing (default 50) |
| `RECONCILE_INTERVAL_MS` | reconcile sweep cadence (default 30000) |
| `RUN_SEED` | deploy-only — set `false` to skip the wipe-and-reseed on redeploy |
| `PORT` | injected by host; defaults to 3001 locally |

### `apps/channel-stub` (Fastify)

| Var | Purpose |
| --- | --- |
| `CRM_RECEIPT_URL` | where to POST lifecycle callbacks (crm-api `/receipts`) |
| `DELIVERED_RATE` / `OPEN_RATE` / `CLICK_RATE` / `CONVERT_RATE` | funnel probabilities |
| `DUPLICATE_PCT` | fraction of callbacks duplicated (exercises idempotency) |
| `MIN_DELAY_MS` / `MAX_DELAY_MS` | callback jitter window (exercises out-of-order arrival) |
| `PORT` | injected by host; defaults to 3002 locally |

## Useful commands

| Command | Does |
| --- | --- |
| `pnpm dev` | all three services in parallel |
| `pnpm dev:web` / `dev:crm-api` / `dev:channel-stub` | a single service |
| `pnpm lint && pnpm typecheck && pnpm test` | the quality gate |
| `pnpm db:migrate` / `db:seed` / `db:studio` / `db:generate` | Prisma workflows |
| `pnpm reconcile` | run the reconcile sweep once (debug) |
| `pnpm load` | push N communications through launch → stub → receipts (load + chaos harness) |

## Tips

- **Seed is idempotent and destructive** — it wipes and rebuilds the "Looms" dataset. That's fine
  locally; in production set `RUN_SEED=false` to preserve loop-generated data on redeploys.
- **One AI key is enough** to try the console. Add more to exercise the fallback chain (watch the
  `[ai/providers] boot` and `[/api/chat] turn served by` logs to see which provider serves).
- **Watch the loop:** after launching, the dashboard funnel climbs as the worker drains the queue and
  the stub fires callbacks. `pnpm load` is the fast way to see it under volume.
