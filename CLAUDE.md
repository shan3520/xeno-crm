# CLAUDE.md — Xeno AI-Native Mini CRM

## What this is
A conversational campaign console for D2C/retail brands. A marketer states intent in
plain English; the AI emits STRUCTURED, EDITABLE artifacts — an auditable segment rule,
per-channel message copy, and a results narrative grounded in real stats. The marketer
reviews and approves; the system simulates the full message lifecycle via a separate
channel stub and tracks delivered/opened/read/clicked/converted.

This is a MARKETING & ENGAGEMENT CRM, in the spirit of Xeno. It is NOT a sales/support
CRM — no deals, pipelines, leads, or tickets.

## Locked tech stack (do not deviate)
- Monorepo: pnpm workspaces + Turborepo
- Web:        Next.js 15 (App Router), TS, Tailwind, shadcn/ui, TanStack Query, Recharts
- AI:         Vercel AI SDK (`ai`, `@ai-sdk/react`, `@ai-sdk/google`), runs in the
              Next.js server (/api/chat). Gemini 2.5 Flash via env GEMINI_MODEL;
              Gemini 2.5 Flash-Lite for cheap classification via GEMINI_MODEL_FAST.
- CRM API:    NestJS (TS), Prisma, nestjs-zod, in-process queue worker
- Channel:    Fastify (TS), in-memory delayed callbacks — minimal, separate service
- DB:         PostgreSQL on Neon (Prisma)
- Queue:      POSTGRES-BACKED. No Redis, no BullMQ. The Communication row is the
              work item, claimed via SELECT ... FOR UPDATE SKIP LOCKED with a lease
              (lockedAt/lockedBy), backoff (nextAttemptAt), and dead-letter on max attempts.
- Deploy:     Vercel (web) + Render x2 (crm-api, channel-stub) + Neon (Postgres)
              + GitHub Actions cron pinging /health to defeat free-tier cold starts.

## Folder structure
xeno-crm/
├── apps/
│   ├── web/                      # Next.js: console UI + AI orchestration (/api/chat)
│   ├── crm-api/                  # NestJS: domain, send-queue worker (in-process), receipts
│   │   └── prisma/               # schema.prisma, migrations, seed.ts
│   └── channel-stub/             # Fastify: /send + lifecycle simulator + in-memory callbacks
├── packages/
│   └── shared/                   # Zod schemas, segment DSL, channel/status enums, DTO types
├── tools/load/                   # load + chaos harness for the callback loop
├── docs/scenarios.md             # scripted on-camera demo scenarios
├── .github/workflows/keepalive.yml  # cron: GET /health on both Render services
├── pnpm-workspace.yaml
├── turbo.json
├── CLAUDE.md
└── TRADEOFFS.md

## Ownership boundaries (parallel build — stay in your lane)
The build runs two tracks at once after the skeleton is frozen. Do NOT edit files outside
the track you are working in; all tracks meet only at the frozen `@xeno/shared` contracts.
- CRITICAL PATH (Claude Code): crm-api/src/{ingest,customers,orders,segments,campaigns,
  send-worker,receipts}, web/{app/api/chat, app shell, console + segment/message/launch cards}
- MISSION A (Antigravity): apps/channel-stub/** only
- MISSION B (Antigravity): crm-api/src/analytics/**, web/app/(dashboard)/campaigns/**,
  web/components/charts/**
- MISSION C (Antigravity): crm-api/prisma/seed.ts, tools/load/**, docs/scenarios.md

## Commands
- pnpm install
- pnpm dev                      # turbo: web + crm-api + channel-stub
- pnpm --filter web dev | --filter crm-api dev | --filter channel-stub dev
- pnpm db:migrate               # prisma migrate dev (crm-api)
- pnpm db:seed                  # faker-based realistic seed
- pnpm db:studio
- pnpm lint && pnpm typecheck && pnpm test
- pnpm load                     # tools/load: push N comms through launch->stub->receipts
- pnpm worker:once              # process the queue a single pass (debug)

## HARD CONSTRAINTS — do NOT
1. Do NOT integrate any real provider (Twilio, SendGrid, Meta, etc). channel-stub is the
   only "provider." Sending is always: CRM worker -> stub /send -> stub callbacks -> CRM.
2. Do NOT use a paid or Anthropic runtime model in the app. The product's only LLM is
   Gemini via @ai-sdk/google. (Claude is used to BUILD, never called from app runtime.)
3. Do NOT let the AI write to the database. AI tools return structured objects validated
   by shared Zod schemas; the CRM API is the sole writer.
4. Do NOT add Redis or BullMQ. The queue is Postgres-backed (SKIP LOCKED + lease + backoff
   + dead-letter). Adding Redis is a hard no for this scope.
5. Do NOT make callbacks synchronous. The stub schedules them on jittered in-memory timers
   and they must be handled arrival-order-INDEPENDENT.
6. Do NOT compute Communication.status from arrival order. Status = projection over
   CommunicationEvent by type precedence on `occurredAt`. Receipts idempotent on idempotencyKey.
7. Do NOT skip the append-only CommunicationEvent log. It is the source of truth.
8. Do NOT build a manual segment query-builder UI. Segments come from the AI as DSL JSON;
   the user may only edit the emitted rule.
9. Do NOT use Prisma anywhere in apps/web. Web talks only to CRM REST + /api/chat.
10. Do NOT build sales/support CRM features (deals, pipelines, leads, tickets).
11. Do NOT add auth. Single seeded workspace.
12. Handle Gemini 429s with exponential backoff + a typed "rate-limited, retry" surface.
    Never crash a chat turn on a transient 429.
13. No secrets in repo. TS strict, no `any`. Segment compiler runs ONLY against a field whitelist.

## Conventions
- Local ports: web 3000, crm-api 3001, channel-stub 3002.
- IDs: cuid. Money: Prisma Decimal. Timestamps: timestamptz, UTC.
- Shared Zod schemas in packages/shared are the single source of truth (AI tools + DTOs)
  and are FROZEN after the skeleton phase — changing them is a cross-track event.
- Model strings come only from env (GEMINI_MODEL / GEMINI_MODEL_FAST); never hardcode them.
- Every AI call writes an AiTaskLog row (model, tokens if available, latencyMs).
- Branch per mission; PR into main; resolve conflicts at the @xeno/shared boundary.
