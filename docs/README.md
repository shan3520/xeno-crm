# Documentation

Detailed documentation for **Looms · AI-Native Mini CRM**. Start at the
[repository README](../README.md) for the overview; this folder holds the depth.

| Doc | What's inside |
| --- | --- |
| [architecture.md](architecture.md) | The three services, request flows, design principles, scale assumptions |
| [send-loop.md](send-loop.md) | **The core system-design piece:** Postgres queue, worker, channel lifecycle, idempotent receipts, projection, reconcile sweep |
| [data-model.md](data-model.md) | Entities, relationships, and the modelling decisions behind them |
| [api-reference.md](api-reference.md) | Every HTTP endpoint across web, crm-api, and channel-stub |
| [ai-native.md](ai-native.md) | The AI design: tools, the segment DSL, the provider fallback chain, guardrails |
| [local-development.md](local-development.md) | Run it locally — prerequisites, env matrix, commands |
| [deployment.md](deployment.md) | Deploy to Vercel + Render + Neon (by-hand runbook) |
| [Tradeoffs](../README.md#tradeoffs-and-scale-assumptions) | **Explicit tradeoffs & scale assumptions** — what was chosen, and what was consciously left out (in the root README) |
| [scenarios.md](scenarios.md) | Scripted on-camera demo walkthroughs |

Suggested reading order for a reviewer: **architecture → send-loop → ai-native → data-model**, then
the **[Tradeoffs section](../README.md#tradeoffs-and-scale-assumptions)** in the README, with
**api-reference** and **local-development** as references.
