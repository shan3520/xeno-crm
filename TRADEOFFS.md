# TRADEOFFS.md

Format per row: **Decision** — what I shipped for this scope · **Why** · **At scale** what I'd change.
"I'd do X at scale but did Y for this scope" is the intended reading.

## Cost & free-tier (this build is $0)
- **Runtime LLM = Gemini 2.5 Flash (free), not Anthropic** — Why: no budget; the Anthropic API
  is paid. Claude (Pro) was used to BUILD; the app's runtime model is Gemini via @ai-sdk/google.
  The structured-output design is provider-agnostic — one provider string changes, nothing else.
  At scale: paid tier or Vertex AI (no training on inputs), provider abstraction + model fallback.
- **Free-tier Gemini may use prompts for training** — acceptable because ALL data is synthetic
  (no real shoppers). At scale: Vertex AI / paid tier to remove data-sharing + lift rate limits.
- **Gemini free rate limits (~15 RPM / ~1k–1.5k RPD)** — Why: single-user demo never approaches
  it. Mitigation: exponential backoff + a typed "rate-limited" UI state. At scale: paid quota.
- **Hosting: Vercel (web) + Render x2 (crm-api, channel-stub) + Neon (Postgres)** — Why: all $0,
  no card on the load-bearing pieces (Railway is no longer a real free tier). Tradeoff: Render
  free services spin down after 15 min idle (cold start) and the stub's in-memory timers are lost
  on restart. Mitigation: GitHub Actions keep-alive on /health during the eval window; demos run
  warm. At scale: always-on paid instances + durable callback scheduling.
- **Neon free Postgres (scale-to-zero, 0.5 GB, never expires)** — Why: $0, ample for synthetic
  data + load tests, survives the whole build→submit→interview window. Tradeoff: sub-second cold
  start; 100 compute-hours/month (don't leave a 24/7 pinger on). At scale: paid Neon (autoscale).
- **5k load test run locally, not on free hosting** — Why: Render free CPU is modest; the
  correctness invariants (idempotency, monotonic status, counter == event-aggregate) hold at any
  volume and are what matter. At scale: the same loop on provisioned compute.
- Queue + worker decisions live under "The send / callback loop" below.

## Product scoping
- **No manual segment builder** — UI only lets you edit the AI-emitted DSL rule.
  Why: betting NL + editable rule beats a query-builder for marketers; keeps the AI central.
  At scale: add a power-user visual query builder + saved/reusable segment library.
- **Single brand persona ("Looms")** — Why: a concrete demo lands better than abstract.
  At scale: full multi-brand catalog + per-brand config.
- **Three AI touchpoints only** (rule, copy, narrative) — Why: depth over breadth; these are
  the genuinely hard translations. At scale: send-time optimization, channel selection,
  budget pacing, autonomous multi-step agent with approvals.

## Auth & tenancy
- **No auth, single seeded workspace** — Why: out of scope; zero rubric value; saves days.
  At scale: Auth.js/Clerk, multi-tenant row isolation, RBAC, audit logging.

## Segmentation
- **Dynamic evaluation on read; audience frozen at launch** — Why: correct + simple at this size.
  At scale: materialized membership, incremental/CDC updates, cached counts.
- **Field/operator whitelist + DSL compiler (no raw SQL)** — Why: safety + auditability for
  AI-generated queries. At scale: richer operators, query cost limits, generated-rule eval suite.

## The send / callback loop (core)
- **Append-only CommunicationEvent + status as projection (precedence over occurredAt)** —
  kept; this IS the scalable design. Why: arrival-order-independent, idempotent, replayable.
  At scale: move the event stream to Kafka; OLAP store (ClickHouse) for analytics.
- **Postgres-backed queue instead of Redis/BullMQ** — the Communication row is the work item,
  claimed via SELECT ... FOR UPDATE SKIP LOCKED with a lease (lockedAt/lockedBy), backoff
  (nextAttemptAt), and dead-letter on max attempts. Why: removes a paid/constrained dependency
  AND is a cleaner system-design story than "BullMQ did it." At scale: dedicated jobs table or a
  real broker (Kafka/SQS), DLQ + alerting, partitioned consumers, per-channel rate limits.
- **Worker runs in the crm-api process** — Why: one fewer deployable on free hosting.
  At scale: separate worker fleet with horizontal scaling + backpressure.
- **Retry with exponential backoff + jitter, N attempts → FAILED** — Why: enough to show the
  mechanic. At scale: dead-letter queue + circuit breaker per channel.
- **Channel stub probabilities env-tunable; in-memory timers** — Why: deterministic-ish demos,
  minimal stub. Tradeoff: a stub restart drops in-flight schedules (acceptable for a stub).
  At scale: real providers behind an adapter interface; the stub becomes a test double.
- **Synthetic conversion attribution (last-touch via CONVERTED callback)** — Why: demonstrates
  "order came from this comm." At scale: real attribution windows, multi-touch models, holdouts.

## Analytics & consistency
- Analytics merged to main ahead of its backend contract; dashboards render on empty/zero data until the send→receipt loop is live. Reconcile root QueryClientProvider + card styling in the frontend phase.
- **Denormalized campaign counters updated by the receipt handler** — Why: fast dashboards.
  Tradeoff: eventual consistency; load harness asserts counters == event aggregates.
  At scale: stream processing / pre-aggregated rollups.
- **Stats refresh via polling while SENDING** — Why: simplest reliable live-ish updates.
  At scale: SSE/WebSocket push, server-driven invalidation.

## AI
- **Gemini calls synchronous in the request path for drafting** — Why: single-user demo.
  At scale: response caching, rate limiting, model fallback, batching, prompt versioning.
- **AI never writes to DB; tools return validated structured objects** — kept; principled
  boundary. At scale: same boundary, plus offline evals + guardrail/rejection metrics.

## Platform
- **Single-region deploy, managed Neon Postgres** — Why: speed + $0. At scale: read replicas,
  multi-region, dedicated connection pooling.
- **No PII encryption / consent / suppression** — Why: out of scope, and all data is synthetic.
  At scale: encryption at rest, consent + opt-out, suppression lists, GDPR/DPDP compliance.

## Lessons Learned
- **Raw SQL bypasses Prisma's type safety** — A parallel agent shipped a raw query with the wrong casing. Caught because I understood the schema's default mapping.
- **Lost-update race in receipt projection (found via load test, fixed)** — concurrent callbacks for the same comm
  did read-modify-write without a row lock; last writer could regress status (DELIVERED→SENT) and deadlock completion
  at ~2.4% under burst. Fix: SELECT ... FOR UPDATE on the comm as the first txn statement, serializing per-comm
  projection. The append-only event log stayed correct throughout — only the materialized cache drifted, which is why
  it was detectable and self-healable.
- **Completion/reconciliation sweep** — callbacks can be dropped (stub retries 3× then drops its in-memory timer;
  real channels drop webhooks too). A periodic sweep re-projects from the event log and re-checks completion, so a
  campaign can't hang on a callback that never arrives. At scale: durable callback queue + DLQ instead of best-effort.
- **Receipt throughput vs remote Neon** — receipts hold a pooled connection for a full round-trip; under burst the
  pool saturated (Prisma 2003ms maxWait). Mitigated via Neon pooled endpoint + bounded worker concurrency. At scale:
  co-located DB, higher pool limits, async receipt ingestion.
