# DEPLOY.md — Xeno mini-CRM free-tier deployment

A by-hand runbook to take this monorepo from zero to **three live URLs**:

| Service        | Host           | What runs there                                                        |
| -------------- | -------------- | ---------------------------------------------------------------------- |
| `web`          | Vercel (Hobby) | Next.js console UI + AI orchestration (`/api/chat`)                     |
| `crm-api`      | Render (free)  | NestJS domain + Postgres queue + **in-process** worker & reconcile + `/receipts` |
| `channel-stub` | Render (free)  | Fastify provider stub: `/send` + jittered lifecycle callbacks          |
| Postgres       | Neon (free)    | already provisioned                                                    |

The send pipeline crosses all three over public URLs:

```
web (Vercel) ──REST──> crm-api (Render) ──/send──> channel-stub (Render) ──/receipts──> crm-api
                ▲                                                                            │
                └──────────────── browser dashboard reads stats ◀───────────────────────────┘
```

> **You cannot run the Vercel/Render CLIs from here** — this doc is a human runbook. Every
> dashboard action below gives exact field values. No secrets live in the repo; all real
> values go into provider env / GitHub Variables.

---

## 0. Prerequisites (once)

- A GitHub repo holding this monorepo, pushed to `main`.
- Accounts: [Neon](https://neon.tech) (done), [Render](https://render.com), [Vercel](https://vercel.com).
- A **Gemini API key** (Google AI Studio).
- Your Neon connection strings (Neon dashboard → your project → **Connect**):
  - **Pooled** — host contains `-pooler`, e.g. `...-pooler.<region>.aws.neon.tech`. Used by crm-api at **runtime**.
  - **Direct** — same host **without** `-pooler`. Used only for migrations/seed.

**Deploy order matters:** do **crm-api + channel-stub first** so their `*.onrender.com` URLs
exist, then point each at the other, then deploy **web** last pointing at crm-api.

---

## 1. Neon — confirm connection strings

You already have the database. From Neon → **Connect**, copy both strings and shape them:

- **Pooled (runtime `DATABASE_URL`)** — append Prisma/PgBouncer params:
  ```
  postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require&pgbouncer=true&connection_limit=5
  ```
  `pgbouncer=true` disables prepared statements (required behind Neon's pooler);
  `connection_limit=5` keeps crm-api from exhausting the pool (this is the mitigation for
  the pool pressure observed under load — `WORKER_CONCURRENCY=5` matches it).

- **Direct (`MIGRATE_DATABASE_URL`)** — the non-pooled host, for `migrate deploy` + seed:
  ```
  postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/DBNAME?sslmode=require
  ```

> **Why two:** `prisma migrate deploy` and the seed take advisory locks / use prepared
> statements that Neon's PgBouncer pooler doesn't support. The build runs them against the
> **direct** URL; the app runs against the **pooled** URL. If you only have one URL, you can
> set just `DATABASE_URL` (pooled) and leave `MIGRATE_DATABASE_URL` unset — migrations will
> use the pooled URL and usually work, but the direct URL is the safe path.

---

## 2. Render — deploy `crm-api` and `channel-stub`

The repo ships a **Blueprint** at `render.yaml` defining both services (rootDir = repo root,
pnpm + Turborepo filtered builds, `/health` health checks, migrate+seed on crm-api).

### 2a. Create the services from the Blueprint

1. Render dashboard → **New +** → **Blueprint**.
2. Connect the GitHub repo. Render reads `render.yaml` and shows **xeno-crm-api** and
   **xeno-channel-stub** (both `free`, region `oregon`).
3. Click **Apply**. Render creates both. The **first build will fail or the app will
   crash-loop** until you set the `sync: false` env vars below — that's expected, because
   the cross-service URLs don't exist until both services are created. Continue to 2b.

> Node version comes from `.nvmrc` (22). pnpm comes from `corepack enable` + the
> `packageManager` field (`pnpm@11.5.2`). You don't configure these in the dashboard.

### 2b. Set env vars (Render dashboard → each service → **Environment**)

Most knobs are already pinned in `render.yaml`. You only fill the `sync: false` ones.

**xeno-crm-api** → Environment:

| Key                    | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`         | the **pooled** Neon string from step 1                                |
| `MIGRATE_DATABASE_URL` | the **direct** Neon string from step 1 (optional but recommended)     |
| `CHANNEL_STUB_URL`     | `https://xeno-channel-stub.onrender.com`                              |
| `PUBLIC_BASE_URL`      | `https://xeno-crm-api.onrender.com`                                   |
| `WEB_ORIGIN`           | your Vercel URL — set after step 3, e.g. `https://xeno-crm.vercel.app` |

(Already set from the Blueprint, no action: `NODE_ENV`, `WORKER_CONCURRENCY=5`,
`WORKER_MAX_ATTEMPTS=5`, `SEND_RATE_PER_SEC=20`, `RECONCILE_INTERVAL_MS=30000`, `RUN_SEED=true`.)

**xeno-channel-stub** → Environment:

| Key               | Value                                          |
| ----------------- | ---------------------------------------------- |
| `CRM_RECEIPT_URL` | `https://xeno-crm-api.onrender.com/receipts`   |

(Already set: `DELIVERED_RATE`, `OPEN_RATE`, `CLICK_RATE`, `CONVERT_RATE`, `DUPLICATE_PCT`,
`MIN_DELAY_MS`, `MAX_DELAY_MS`.)

> The exact service names above assume you kept the `render.yaml` names. If Render appended a
> suffix, use the real URL shown on each service's page (top of the dashboard).

### 2c. Redeploy and verify

1. **xeno-channel-stub** → **Manual Deploy → Deploy latest commit**. Wait for green.
   - Verify: open `https://xeno-channel-stub.onrender.com/health` → `{"status":"ok","service":"channel-stub"}`.
2. **xeno-crm-api** → **Manual Deploy → Deploy latest commit**. The build runs
   `prisma migrate deploy` then the **Looms seed** against Neon (watch the build log:
   "~2,000 customers, ~6,000 orders").
   - Verify: `https://xeno-crm-api.onrender.com/health` → `{"status":"ok"}`.

> **Re-seeding:** the seed is idempotent — it **wipes and rebuilds** the Looms dataset, which
> also clears any communications/campaigns produced by running the loop. To preserve
> loop-generated demo data on later deploys, set crm-api env `RUN_SEED=false`.

---

## 3. Vercel — deploy `web`

Vercel builds `apps/web` but installs at the pnpm-workspace root and must build
`@xeno/shared` first (it ships as compiled CJS), so the build command runs Turborepo.

### 3a. Import the project

1. Vercel → **Add New… → Project** → import the GitHub repo.
2. **Root Directory:** click **Edit** → select **`apps/web`**. Leave
   *"Include files outside the root directory"* **enabled** (Vercel auto-detects the monorepo).
3. **Framework Preset:** **Next.js** (auto-detected).
4. **Build & Output Settings** → override:
   - **Install Command:** `pnpm install --frozen-lockfile`
   - **Build Command:** `cd ../.. && pnpm turbo run build --filter=@xeno/web`
     (runs Turbo from the repo root so `@xeno/shared` compiles before `next build`).
   - **Output Directory:** leave default (`.next`).

### 3b. Environment Variables (Vercel → Project → Settings → Environment Variables)

Set all for the **Production** environment (and Preview if you want preview deploys to work):

| Key                       | Value                                                  |
| ------------------------- | ------------------------------------------------------ |
| `GEMINI_API_KEY`          | your Gemini key                                        |
| `GEMINI_MODEL`            | `gemini-2.5-flash`                                     |
| `GEMINI_MODEL_FAST`       | `gemini-2.5-flash-lite`                                |
| `CRM_API_URL`             | `https://xeno-crm-api.onrender.com`  (server-side)     |
| `NEXT_PUBLIC_CRM_API_URL` | `https://xeno-crm-api.onrender.com`  (browser)         |

> **Both** CRM URL vars are required: `CRM_API_URL` is read server-side by `/api/chat`
> (`lib/crm-client.ts`); `NEXT_PUBLIC_CRM_API_URL` is read in the browser by the dashboard
> (`lib/analytics-api.ts`). Set them to the same Render crm-api URL.

### 3c. Deploy and capture the URL

1. **Deploy**. When green, note the production URL, e.g. `https://xeno-crm.vercel.app`.

### 3d. Close the CORS loop ⚠️ (do not skip)

1. Render → **xeno-crm-api** → Environment → set `WEB_ORIGIN` to the Vercel URL from 3c
   (e.g. `https://xeno-crm.vercel.app`, no trailing slash) → **Save**, which redeploys crm-api.
   - crm-api enables CORS for exactly this origin (`main.ts` → `enableCors({ origin: WEB_ORIGIN })`).
     The browser dashboard's `fetch`es to crm-api will fail with a CORS error until this is set.

---

## 4. End-to-end verification (web → crm-api → stub → /receipts)

1. Open the Vercel URL. The dashboard should load campaign analytics (browser → crm-api;
   confirms `NEXT_PUBLIC_CRM_API_URL` + CORS).
2. In the console, drive a campaign: state intent → review the segment rule → review copy →
   **launch**. This makes web (`/api/chat`) → crm-api (server side; confirms `CRM_API_URL`).
3. crm-api's in-process worker claims the queued communications → POSTs to channel-stub
   `/send` → the stub schedules jittered callbacks → POSTs back to crm-api `/receipts`.
4. Within ~30s the dashboard delivered/opened/clicked/converted counts climb as receipts land
   and the reconcile sweep runs. That round-trip confirms all three public URLs reach each other.

Quick curl checks:

```bash
curl https://xeno-crm-api.onrender.com/health        # {"status":"ok"}
curl https://xeno-channel-stub.onrender.com/health    # {"status":"ok","service":"channel-stub"}
```

---

## 5. Keep-alive (defeat Render cold starts during the eval window)

`.github/workflows/keepalive.yml` pings both `/health` URLs every ~10 minutes.

**Enable it** (GitHub repo → **Settings → Secrets and variables → Actions → Variables tab**):

| Variable           | Value                                          |
| ------------------ | ---------------------------------------------- |
| `KEEPALIVE_ENABLED`| `true`                                         |
| `CRM_API_URL`      | `https://xeno-crm-api.onrender.com`            |
| `CHANNEL_STUB_URL` | `https://xeno-channel-stub.onrender.com`       |

These are **Variables**, not Secrets (URLs aren't sensitive). The workflow also runs on
**workflow_dispatch** so you can trigger it manually from the **Actions** tab.

**Disable it** when not demoing (so it stops waking Neon and burning compute):

- Fastest: repo → **Actions → keepalive → ··· → Disable workflow**, **or**
- Set `KEEPALIVE_ENABLED = false` (the job is gated on `== 'true'`).

> GitHub also auto-disables scheduled workflows after 60 days of repo inactivity, and cron is
> best-effort (may lag a few minutes). Re-enable from the Actions tab when needed.

---

## 6. Known free-tier behaviors (read before the demo)

- **Render cold start (~50s):** a free service spins down after ~15 min idle; the next request
  pays a ~50s cold start. The keep-alive (§5) prevents this **during** your eval window. Outside
  it, the first hit after idle will be slow — warm both `/health` URLs a minute before demoing.
- **Neon scale-to-zero:** the free Neon compute suspends when idle and takes a few seconds to
  wake on the first query. Combined with a Render cold start, the very first request of a session
  can be slow; subsequent ones are fast. The keep-alive indirectly keeps Neon warm too — which is
  exactly why you should **disable** it outside demo windows to conserve Neon compute.
- **In-process worker:** the send-worker and reconcile sweep run **inside** the crm-api service —
  there is no separate worker dyno/service, by design. When crm-api is cold/asleep, the queue
  drains only once it wakes (a `/health` ping or any request wakes it).
- **Load testing:** run the headline high-volume load test (`pnpm load`) **locally**, not against
  free hosting. Render free CPU + Neon free pool + the keep-alive's modest ceilings
  (`WORKER_CONCURRENCY=5`, `SEND_RATE_PER_SEC=20`) are tuned for a smooth demo, not throughput
  benchmarks.

---

## 7. Local dev is unchanged

All production config is additive (env-driven). Locally:

```bash
pnpm install
pnpm dev        # web :3000, crm-api :3001, channel-stub :3002
```

Local `.env` files keep their defaults (`localhost` URLs, direct `DATABASE_URL`,
`WEB_ORIGIN=http://localhost:3000`). `MIGRATE_DATABASE_URL` and `RUN_SEED` are deploy-only and
unset locally. See each app's `.env.example` for the full key list.

---

## Appendix — env var matrix

**web (Vercel):** `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_MODEL_FAST`, `CRM_API_URL`,
`NEXT_PUBLIC_CRM_API_URL`

**crm-api (Render):** `DATABASE_URL` (pooled), `MIGRATE_DATABASE_URL` (direct, optional),
`CHANNEL_STUB_URL`, `PUBLIC_BASE_URL`, `WEB_ORIGIN`, `WORKER_CONCURRENCY`, `WORKER_MAX_ATTEMPTS`,
`SEND_RATE_PER_SEC`, `RECONCILE_INTERVAL_MS`, `RUN_SEED`, `NODE_ENV` (+ `PORT` injected by Render)

**channel-stub (Render):** `CRM_RECEIPT_URL`, `DELIVERED_RATE`, `OPEN_RATE`, `CLICK_RATE`,
`CONVERT_RATE`, `DUPLICATE_PCT`, `MIN_DELAY_MS`, `MAX_DELAY_MS` (+ `PORT` injected by Render)

**GitHub Actions Variables:** `KEEPALIVE_ENABLED`, `CRM_API_URL`, `CHANNEL_STUB_URL`
