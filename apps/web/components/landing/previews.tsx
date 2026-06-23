import {
  BarChart3,
  Eye,
  MessageSquareText,
  Rocket,
  Users,
} from "lucide-react";

/**
 * Static, faithful reproductions of the real console artifacts, for the marketing page only.
 * These mirror the exact surfaces shipped in components/console/* (token classes, header band,
 * semantic hue, mono figures) so the landing shows the actual product, not a fabricated mockup.
 * They are intentionally non-interactive: no state, no fetch, no "use client".
 */

/** The Looms wordmark glyph: a simple woven mark in the brand iris. */
export function LoomsMark({ className }: { className?: string }) {
  return (
    <span
      className={className}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-full w-full">
        <rect
          x="1.5"
          y="1.5"
          width="21"
          height="21"
          rx="6"
          fill="var(--primary)"
        />
        <path
          d="M7 7v10M12 7v10M17 7v10M5 9.5h14M5 14.5h14"
          stroke="var(--primary-foreground)"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.92"
        />
      </svg>
    </span>
  );
}

/** Reproduction of the audience-segment card (seg / blue). */
export function SegmentPreview() {
  const chips = ["last order > 120 days ago", "lifetime spend ≥ 8000", "city is Mumbai"];
  const sample = [
    { initials: "AR", name: "Asha Rao" },
    { initials: "DK", name: "Devin Kapoor" },
    { initials: "MeF", name: "Meera Fernandes" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/60 shadow-elevated backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-gradient-to-br from-seg/10 to-transparent px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-seg">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Audience segment
          </div>
          {/* A decorative preview label, not a document heading — kept as <p> so the page
              outline doesn't skip H1→H3 (these cards sit in the hero, before the first H2). */}
          <p className="mt-1 truncate text-base font-semibold tracking-tight text-foreground">
            Lapsed Mumbai high-spenders
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Win back valuable customers who have gone quiet.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
            1,284
          </span>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            customers match
          </p>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <p className="text-sm leading-relaxed text-foreground/90">
          <span className="text-muted-foreground">Targeting customers who </span>
          ordered over 120 days ago, have spent at least 8,000, and live in Mumbai.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c}
              className="rounded-full border border-border/70 bg-secondary/60 px-2.5 py-1 text-xs font-medium text-secondary-foreground"
            >
              {c}
            </span>
          ))}
        </div>
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Sample of the audience
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sample.map((s) => (
              <span
                key={s.name}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 py-1 pl-1 pr-2.5 text-xs text-foreground/80"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-seg/15 text-[10px] font-semibold text-seg">
                  {s.initials.slice(0, 2)}
                </span>
                {s.name}
              </span>
            ))}
            <span className="inline-flex items-center rounded-full px-2 py-1 text-xs text-muted-foreground">
              +1,278 more
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Reproduction of the message-copy card (msg / violet), with the live token preview. */
export function MessagePreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/70 shadow-elevated backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-gradient-to-br from-msg/10 to-transparent px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-msg">
            <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
            Message copy
          </div>
          {/* Decorative preview label, not a heading (see note on the segment card above). */}
          <p className="mt-1 text-base font-semibold tracking-tight text-foreground">
            Draft for review
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
          Email
        </span>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm leading-relaxed text-foreground">
          Hi{" "}
          <span className="rounded bg-msg/15 px-0.5 font-mono text-[13px] text-msg">
            {"{{firstName}}"}
          </span>
          , we saved your size. Here is 15% off your next order in{" "}
          <span className="rounded bg-msg/15 px-0.5 font-mono text-[13px] text-msg">
            {"{{city}}"}
          </span>
          .
        </div>

        <div className="rounded-xl border border-border/60 bg-background/30 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            Preview · Asha Rao
          </div>
          <p className="text-sm leading-relaxed text-foreground">
            Hi{" "}
            <span className="rounded bg-msg/15 px-0.5 text-msg">Asha</span>, we
            saved your size. Here is 15% off your next order in{" "}
            <span className="rounded bg-msg/15 px-0.5 text-msg">Mumbai</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

const FUNNEL = [
  { stage: "Delivered", value: 4812, token: "--chart-1" },
  { stage: "Opened", value: 3109, token: "--chart-5" },
  { stage: "Read", value: 2447, token: "--chart-3" },
  { stage: "Clicked", value: 901, token: "--chart-2" },
  { stage: "Converted", value: 318, token: "--chart-4" },
];

/** A compact funnel using the tokenized chart ramp, plus the honest-failure line. */
export function FunnelPreview() {
  const top = FUNNEL[0].value;

  return (
    <div className="rounded-2xl border border-border bg-card/50 p-5 shadow-elevated sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-results">
          <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
          Results
        </div>
        <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
          Sample campaign
        </span>
      </div>

      <div className="space-y-3">
        {FUNNEL.map((row) => {
          const pct = Math.round((row.value / top) * 100);
          return (
            <div key={row.stage} className="grid grid-cols-[88px_1fr_auto] items-center gap-3">
              <span className="text-xs text-muted-foreground">{row.stage}</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted/40">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: `var(${row.token})` }}
                />
              </div>
              <span className="w-12 text-right font-mono text-xs tabular-nums text-foreground">
                {row.value.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/60 pt-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--fail-1)" }} />
          112 failed delivery
        </span>
        <span className="font-mono">opens n/a for SMS</span>
      </div>
    </div>
  );
}

/** Reproduction of the launch confirmation surface (launch / emerald). */
export function LaunchPreview() {
  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-launch/10 to-transparent p-5 shadow-elevated">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-launch">
        <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
        Launch
      </div>
      <p className="mt-3 text-sm leading-relaxed text-foreground/90">
        Send <span className="font-mono text-foreground">Email</span> to{" "}
        <span className="font-mono text-foreground">1,284</span> customers in
        the <span className="text-launch">Lapsed Mumbai high-spenders</span>{" "}
        segment.
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        Nothing sends until you confirm.
      </p>
    </div>
  );
}
