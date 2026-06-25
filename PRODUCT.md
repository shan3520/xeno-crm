# Product

## Register

product

## Users

D2C and retail-brand marketers (the "growth" or "CRM" person at a consumer brand).
Their context: they have a campaign idea in plain language ("win back lapsed sneaker
buyers", "thank loyal Gold-tier customers in Mumbai") and need to turn it into a real,
auditable send without writing SQL, learning a query builder, or trusting a black box.

The job to be done: **state intent, review what the AI proposed, edit it, and launch with
confidence** — then read back honest, stat-grounded results. The marketer is always the
approver; the AI is a drafting assistant, never an autonomous actor. On any given screen the
primary task is either (a) shaping one of three structured artifacts — an audience segment,
per-channel message copy, a launch — or (b) reading a single campaign's delivery and
conversion performance.

## Product Purpose

Looms is an AI-native, conversational campaign console for marketing & engagement (in the
spirit of Xeno). A marketer describes an audience and a message in English; the AI emits
**structured, editable artifacts** — an auditable segment rule (DSL JSON), channel-specific
copy with live token preview, and a results narrative grounded in real numbers. The system
then simulates the full message lifecycle (delivered → opened → read → clicked → converted)
through a separate channel stub and tracks it on an append-only event log.

It exists because the two common failure modes are both bad: a manual query-builder CRM is
too slow and technical for a marketer, and a fully-autonomous AI is not trustworthy enough to
let near a customer list. Looms splits the difference — the AI does the drafting, the human
keeps the keys. Success looks like a marketer going from a sentence to a launched, tracked
campaign in minutes, never feeling they approved something they couldn't see or edit.

This is a **marketing & engagement** CRM. It is explicitly **not** a sales/support CRM: no
deals, pipelines, leads, or tickets.

## Brand Personality

**Calm, precise, trustworthy.** The tool should disappear into the task. Three words:
*quiet, auditable, exact.*

Voice and tone: plain, specific, and honest. Copy names what will happen ("Nothing sends
until you confirm a launch") rather than hyping. Numbers are reported straight, including the
unflattering ones (failures, n/a-for-SMS, "that turn went quiet"). The emotional goal is
**confidence at the moment of approval** — the marketer should feel they can see exactly what
the AI built and exactly what pressing launch will do.

The visual expression of this is the "Quiet Console": a warm near-black canvas, a single
brass/gold accent for chrome, and a deliberately desaturated semantic family that color-codes
the four AI artifact types (segment / message / launch / results) so they read as one
intentional set rather than raw framework hues.

## Anti-references

- **Generic AI-SaaS slop.** No gradient-text heroes, no rainbow chart palettes, no endless
  identical icon-card grids, no cream/violet startup-template look. Distinctiveness comes from
  the committed dark "Quiet Console" system, not from decoration.
- **Sales/support CRM (Salesforce / HubSpot).** No heavy enterprise chrome, no
  deals/pipelines/leads/tickets framing, no cluttered multi-toolbar density. This product is
  engagement, not sales operations.
- **Chatbot toy.** Not a bare chat box. The product's value is the editable, auditable
  artifacts the conversation produces; the chat is the input, the structured cards are the
  point.
- **Loud marketing dashboard.** No gradient KPI mega-tiles, no confetti, no vanity-metric
  theater. Reporting is honest and stat-grounded — it shows the funnel and the failures, not a
  hype reel.

## Design Principles

1. **The human holds the keys.** Every AI output is a proposal the marketer reviews and edits;
   nothing irreversible happens without an explicit confirm. The UI's job is to make what the
   AI built fully visible and fully editable.
2. **Structured over conversational.** Lead with the auditable artifact (segment rule, message
   copy, launch panel, results narrative), not with chat prose. The conversation is plumbing;
   the cards are the product.
3. **Honest numbers.** Report real results including the unflattering ones — failures, gaps
   ("n/a for SMS"), stalls, low rates. Never round away the truth or theater a vanity metric.
4. **The tool disappears.** Earned familiarity over novelty: standard affordances, consistent
   component vocabulary, calm motion that conveys state and nothing more. The marketer stays in
   flow.
5. **One quiet system.** A single restrained palette and a tokenized semantic family carry the
   whole surface; color means something (artifact type, status, severity) and is never
   decoration.

## Accessibility & Inclusion

Target: **WCAG 2.1 AA.** Concretely — body text ≥ 4.5:1 contrast (and large/bold text ≥ 3:1),
full keyboard operability with a visible focus indicator on every control, correct semantics
(WAI-ARIA tabs, labeled form fields, data charts exposed as labeled images), `prefers-reduced-
motion` honored everywhere, and comfortable ≥ 44px touch targets on coarse pointers. Status and
severity must never be conveyed by color alone — always pair with text or shape. The app runs
dark-first; contrast must be verified against the dark canvas, not assumed from the light
token values.
