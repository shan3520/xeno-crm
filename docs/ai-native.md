# AI-Native Design

The brief asks for AI **woven into the product, not bolted on**. The bet here:

> The marketer talks; the AI proposes **structured, editable artifacts**; the human approves; the
> system executes and measures.

The AI is the fast path to a first draft — never a black box, and never the thing that ships without a
human in the loop.

## The shape: structured editable artifacts

Each AI output is a **typed object the marketer can edit before anything happens**, not free text:

| Artifact | What the AI produces | What the human can do |
| --- | --- | --- |
| **Segment** | an auditable DSL rule tree + live count + sample | hand-edit the rule; count recomputes live |
| **Message** | channel-appropriate copy with `{{tokens}}` | edit copy; see a real-customer preview |
| **Results** | a narrative grounded in fetched stats | read; the numbers are real, not invented |

The AI **never writes to the database.** It returns validated objects; only an explicit user action
(Launch) persists anything, through crm-api.

## Orchestration: `/api/chat`

The console is a chat-first UI backed by [`apps/web/app/api/chat/route.ts`](../apps/web/app/api/chat/route.ts).
It uses the **Vercel AI SDK** `streamText` with three tools and a small step budget
(`MAX_STEPS = 3` → up to two tool calls + a final framing sentence per turn). The model decides which
tool(s) to call from the marketer's intent; results stream back as artifact cards.

The route is the LLM boundary for the whole product. It runs server-side (keys never reach the
browser), and it is the only place a model is called.

## The three tools

Defined in [`apps/web/lib/ai/tools.ts`](../apps/web/lib/ai/tools.ts); input/output validated against
`@xeno/shared`:

1. **`generate_segment_rule`** — turn intent into a DSL definition, then attach a **live** audience by
   calling crm-api `POST /segments/preview`. The `@xeno/shared` schema (with its field/operator
   whitelist) is the gate: a non-whitelisted field fails validation here and never reaches the preview
   or the DB.
2. **`draft_message`** — channel-appropriate copy (EMAIL longer, SMS short) using only the documented
   personalization tokens.
3. **`narrate_results`** — fetch the campaign's real stats (crm-api `GET /campaigns/:id/stats`) and
   explain them in plain language, grounded in those numbers.

### Generation approach: text + parse + Zod (not `generateObject`)

All three tools generate with `generateText` and then **parse + validate** the JSON (`parseJsonObject`
→ Zod), rather than the SDK's `generateObject`. This is a deliberate portability choice: some providers
(e.g. Groq's Llama 3.3) reject the SDK's structured-output `response_format`, while a tight
"return only JSON" prompt + manual parse + strict Zod works across **every** provider in the chain. The
Zod schema remains the hard gate — malformed or off-spec output is rejected before it surfaces.

## The segment DSL

Defined and validated in [`packages/shared/src/segment.ts`](../packages/shared/src/segment.ts); compiled
to SQL in crm-api against the whitelist (the package never touches the DB).

A definition is a **recursive rule tree**:

- **Group:** `{ "op": "AND" | "OR" | "NOT", "conditions": [ <node>, … ] }`
- **Leaf:** `{ "field": <field>, "operator": <operator>, "value": <scalar | array> }`

**Whitelisted fields** (anything else is rejected at parse time):

```
customer.total_spend   customer.order_count   customer.first_order_at   customer.last_order_at
customer.city          customer.tier          customer.tags
order_item.category    order.total_amount     order.status
```

**Whitelisted operators:**

```
eq  neq  in  not_in  gt  gte  lt  lte  contains  within_days  older_than_days
```

Example — *"win back customers who bought sneakers over 60 days ago"*:

```json
{
  "op": "AND",
  "conditions": [
    { "field": "order_item.category",   "operator": "eq",              "value": "sneakers" },
    { "field": "customer.last_order_at", "operator": "older_than_days", "value": 60 }
  ]
}
```

The whitelist is the security boundary: the compiler maps each field to a concrete column/join and
**never accepts a raw field**, so the AI cannot generate a rule that reaches an unintended column or
injects SQL.

## The provider fallback chain

Free-tier LLM providers each have different failure modes (rate limits, latency, structured-output
quirks). Rather than bet on one, the AI layer uses a **config-driven ordered fallback chain**
([`apps/web/lib/ai/providers.ts`](../apps/web/lib/ai/providers.ts)).

- **`AI_PROVIDER_ORDER`** — comma-separated provider ids tried in order (e.g. `groq,nvidia,gemini`). A
  provider whose key is missing is silently skipped.
- **Registry** — each provider declares how to detect its key, its env-driven model id, a log tag, and
  how to build a tool-calling-capable model. Adding a provider is one registry entry + an env var.
- **`withFallback`** wraps the chain as a single AI SDK model. It falls through to the next provider on:
  - **availability errors** — `429`/quota, `5xx`, auth (`401`/`403`), network; and
  - **slowness** — a **per-provider timeout** (`AI_PROVIDER_TIMEOUT_MS`). For streaming it guards
    *time-to-first-chunk* (so a healthy long stream isn't cut off) and, on timeout, fails over instead
    of stalling the whole turn.
  - A genuine request error (e.g. a `400` for a bad request shape) is **rethrown**, not masked.

Model ids are **never hardcoded** — they come from env per provider. Rate-limit/timeout conditions that
survive the chain are surfaced to the UI as a typed, retryable "the model is busy, retry" state rather
than a crash.

### Observability

Two log lines make provider behaviour debuggable in production:

- **Boot:** `[ai/providers] boot — keys present: groq,nvidia,gemini | order: groq,nvidia,gemini`
  (ids only, never key values) — instantly reveals a missing/mis-set key.
- **Per turn:** `[/api/chat] turn served by "<provider>" (<model>)` with a `[FALLBACK]` marker — so a
  silent cascade (e.g. a bad primary key quietly falling through) can't hide.

Every tool call also writes an **`AiTaskLog`** row (kind, model, tokens, latency, input, output) for
cost/latency auditing.

## Guardrails, in one place

- **AI can't write the DB.** It returns validated objects; crm-api is the sole writer; only explicit
  user actions persist.
- **Schema is the gate.** Tool output is validated against `@xeno/shared` (same schemas as the API).
- **Field whitelist** on the segment DSL.
- **Grounded narratives** — results come from fetched stats, never invented.
- **Graceful degradation** — rate limits / timeouts become a typed retry surface; the chat turn never
  crashes on a transient provider error.
