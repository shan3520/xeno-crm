# Design

The visual system for Looms — the "Quiet Console". Captured from the live implementation
(`apps/web/app/globals.css` + the console / chart / dashboard components). Colors are OKLCH.
The app runs **dark-first** (`<html class="dark">`); the light tokens exist for completeness
but are not a shipped theme. Verify all contrast against the dark canvas.

## Theme

Warm, faintly amber-tinted neutrals on a near-black canvas. A single brass/gold brand accent
carries all chrome (logo, primary buttons, focus, active nav, the user chat bubble). A
deliberately desaturated **semantic family**, all tuned to one chroma band with hues spaced
for distinction, color-codes the four AI artifact types so they read as one intentional set
rather than raw framework hues. Mood: a calm, precise instrument — low ambient light, quiet
confidence, nothing shouting. Depth comes from layered translucent surfaces, hairline borders,
and tinted (never flat-black) shadows, plus one faint gold glow pinned behind the canvas.

Strategy: **Restrained.** Tinted neutrals + one brand accent ≤ 10% of surface; semantic
colors used only for meaning (artifact type, status, severity), never decoration.

## Color

OKLCH throughout. Tokens are defined as CSS custom properties and surfaced to Tailwind via
`@theme inline`. Dark values below are the shipped set.

### Core neutrals (dark)

| Token | OKLCH | Role |
|---|---|---|
| `--background` | `0.165 0.004 75` | Near-black canvas, faint amber tint |
| `--foreground` | `0.97 0.004 75` | Primary text |
| `--card` | `0.215 0.005 75` | Raised surface (usually used at `/40`–`/60` opacity) |
| `--popover` | `0.215 0.005 75` | Tooltips, menus |
| `--secondary` | `0.27 0.005 75` | Chips, secondary buttons |
| `--muted` | `0.27 0.005 75` | Muted fills |
| `--muted-foreground` | `0.72 0.012 75` | Secondary text (AA-safe at base; do **not** dim below this for text < 14px) |
| `--accent` | `0.3 0.006 75` | Hover surface |
| `--border` | `1 0 0 / 9%` | Hairline borders (translucent white) |
| `--input` | `1 0 0 / 13%` | Input borders |

### Brand & focus

| Token | OKLCH | Role |
|---|---|---|
| `--primary` | `0.72 0.12 85` | Primary buttons, user chat bubble (dark `--primary-foreground` sits on the gold so it clears AA) |
| `--primary-foreground` | `0.22 0.035 85` | Text on primary (dark, for AA on the gold fill) |
| `--brand` | `0.82 0.11 85` | Brand gold **as text/icon on dark** (brighter than `--primary` for legibility) |
| `--ring` | `0.8 0.11 85` | Focus ring |

### Semantic artifact family (one chroma band, hues spaced)

| Token | OKLCH | Artifact / meaning |
|---|---|---|
| `--seg` | `0.72 0.1 230` | Audience segment — cool blue |
| `--msg` | `0.76 0.1 200` | Message copy — teal/cyan (L raised for AA on small labels) |
| `--launch` | `0.74 0.12 158` | Launch / success — emerald |
| `--results` | `0.74 0.12 350` | Results — rose (brand owns the warm gold) |
| `--warning` | `0.78 0.14 55` | Genuine warnings only |
| `--destructive` | `0.64 0.2 25` | Errors, failures — fills, borders, large alert icons |
| `--destructive-foreground` | `0.83 0.13 25` | Destructive **text** on a tint (lighter for AA) |

> **Contrast note (resolved):** `--destructive` at L 0.64 dips under 4.5:1 as *text* on a
> `destructive/10`–`/15` tint at small sizes, so destructive *text* uses the dedicated
> `--destructive-foreground` (L 0.83), which clears AA (≈6.2–7.1:1). `--destructive` itself
> stays for fills, borders, and large alert icons.

### Data-viz ramps (tokenized, not hard-coded in charts)

- **Calm chart family** `--chart-1..5`: `0.72 0.1 230` (blue), `0.74 0.11 158` (emerald),
  `0.76 0.1 200` (teal/cyan), `0.74 0.12 350` (rose), `0.78 0.1 85` (gold). Drawn from the same
  low-chroma family — never a high-chroma rainbow.
- **Failure severity ramp** `--fail-1..5` (red → amber): `0.64 0.2 25`, `0.68 0.17 45`,
  `0.74 0.15 60`, `0.8 0.14 78`, `0.6 0.19 12`. Visually signals "trouble" against the calm
  chart family.

> Chart fills/strokes are exempt from text-contrast rules, but axis-tick and label text uses
> `--muted-foreground` and must stay legible.

### Usage rules

- One accent per surface. The brand gold is for chrome and primary action only.
- Semantic colors carry meaning; never use them decoratively or at full saturation on
  inactive states (badges use the hue at `/15` fill + the hue as text).
- Status and severity are **never color-only** — always paired with a text label or icon/shape.

## Typography

One family system. **Geist Sans** (`--font-sans`) for all UI — headings, labels, buttons,
body. **Geist Mono** (`--font-mono`) for data: figures, counts, rates, token chips
(`{{firstName}}`). Both loaded via `next/font` with `display: swap`.

- Product scale, **fixed rem (not fluid/clamp)** — users view at consistent DPI.
- Page title `text-2xl` semibold, `tracking-tight`. Card title `text-base` semibold. Big
  figures `text-3xl` bold + `tabular-nums`. Body `text-sm` `leading-relaxed`. Secondary /
  meta `text-xs` and `text-[11px]`.
- Numbers always `tabular-nums` so counts and rates align in columns.
- Uppercase reserved for short artifact-type / section micro-labels (`text-[11px]` +
  `tracking-wider`), used as a deliberate color-coded taxonomy — not as a per-section eyebrow.
- `text-balance` on display headings/empty-state titles; `text-pretty` on lead paragraphs.

## Components

Surfaces are **translucent layered cards** (`bg-card/40`, hairline `border-border`), corners
`rounded-2xl` for artifact cards and `rounded-xl` for chart/stat tiles, lifted by the custom
`shadow-elevated` utility (tinted, two-layer). Nested cards are avoided.

- **Artifact card** (segment / message): header band with a faint `from-{hue}/10` gradient
  wash, an uppercase color-coded type label + icon, an editable body, and inline edit/reset
  actions. Live re-evaluation feedback (debounced re-count, token preview).
- **Buttons**: primary = `bg-primary` solid; secondary/ghost = bordered `bg-background/50` or
  bare hover-fill. All share `active:scale-[0.98]`, `transition`, and `disabled:opacity-40`.
  Icon-only controls (send/stop) are `rounded-xl` squares.
- **Badges/chips**: `rounded-full`, hue at `/15` fill + hue text; status badges add a pulsing
  dot for live states.
- **Inputs/selects/textarea**: `bg-background`, `border-border`, `focus:ring-1 focus:ring-ring`;
  every field carries an `aria-label`.
- **States are complete**: skeleton loaders (not spinners), teaching empty states, error
  states with retry, and console-specific stall/empty-finish retry banners.
- **Charts** (Recharts): vertical bar funnel, stacked area timeline with gradient fills,
  severity-ramped failure bars. Each chart SVG is wrapped in `role="img"` with a generated
  `aria-label` summarizing every figure. Custom tooltip on `bg-popover` + `shadow-elevated`.
- **Tabs**: WAI-ARIA roving-tabindex (Arrow/Home/End), active tab raised on `bg-card` with a
  ring.

## Layout

- `--radius: 0.75rem` base; scale `sm = -4px`, `md = -2px`, `lg = base`, `xl = +4px`.
- **Console**: full-height (`100dvh`) three-row shell — sticky blurred header, scrolling
  conversation (`max-w-3xl` centered), bottom-docked blurred composer with
  `env(safe-area-inset-bottom)` padding.
- **Dashboard**: page header, responsive stat grids (`grid-cols-2 sm:3 lg:6` overview;
  `grid-cols-1 sm:2 lg:4` per-campaign), and a horizontally-scrollable (`overflow-x-auto`)
  campaign table. Detail view splits into Overview / Timeline / Failures tabs.
- Responsive behavior is **structural** (breakpoint column counts, table scroll, stacking
  header), not fluid typography.
- Spacing rhythm is mostly `space-y-6` between major blocks, `gap-3`/`gap-4` within grids.

## Motion

Calm and state-bearing only; no decorative or page-load choreography.

- Default `transition` (~150ms) on hover/focus/color; `active:scale-[0.98]` press feedback.
- Live figures cross-fade color over `duration-500` when stats update.
- Live/sending status uses `animate-pulse` dots; "working" uses `animate-spin`.
- Auto-scroll on new console content respects `prefers-reduced-motion` (manual `matchMedia`
  check → instant jump).
- **Reduced motion is global**: a `@media (prefers-reduced-motion: reduce)` block collapses
  all transitions/animations (keeping only `.animate-spin` so "working…" still reads) and
  disables smooth scroll.

## Accessibility (visual)

- Global `:focus-visible` outline (`2px solid --ring`, `2px` offset) on every button/link/
  `[role=button]`; inputs ring on their own.
- `@media (pointer: coarse)` enforces ≥ 44px hit targets on real controls without touching the
  dense `pointer:fine` console.
- Body text and `--muted-foreground` clear AA on the dark canvas; the only intentional
  sub-base cases are dimmed meta (`/70`, `/40`) at large sizes. Destructive text uses
  `--destructive-foreground` (see Color).
- A faint fixed radial gold glow sits behind the canvas (`body::before`, `z-index:-1`,
  `pointer-events:none`) so the near-black isn't a flat slab; it never repaints on scroll.
