"use client";

import { BarChart3, Lightbulb, TrendingUp } from "lucide-react";

import type { NarrateResultsSuccess } from "@/lib/ai/tool-results";

function pct(value: number | undefined): string {
  return value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function NarrateResultsCard({
  result,
}: {
  result: NarrateResultsSuccess;
}) {
  const { rates, attributedRevenue } = result.stats;
  const revenue = Number(attributedRevenue);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/40 shadow-elevated">
      <div className="flex items-center gap-2 border-b border-border/60 bg-gradient-to-br from-results/10 to-transparent px-5 py-4">
        <BarChart3 className="h-4 w-4 text-results" />
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {result.headline}
        </h2>
      </div>

      <div className="space-y-4 px-5 py-4">
        <p className="text-sm leading-relaxed text-foreground/90">
          {result.whatHappened}
        </p>

        <div className="grid grid-cols-3 gap-2">
          <Metric label="Delivery" value={pct(rates.deliveryRate)} />
          <Metric label="Open" value={pct(rates.openRate)} />
          <Metric label="Click" value={pct(rates.clickRate)} />
        </div>

        {revenue > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-launch/10 px-3 py-2 text-sm text-launch">
            <TrendingUp className="h-4 w-4" />
            <span className="font-semibold tabular-nums">
              ₹{revenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </span>
            attributed revenue
          </div>
        )}

        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-results" />
          <span>
            <span className="font-medium text-foreground/80">Why: </span>
            {result.why}
          </span>
        </p>

        <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-2.5 text-sm">
          <span className="text-[11px] font-medium uppercase tracking-wide text-results">
            Next
          </span>
          <p className="mt-0.5 text-foreground/90">{result.nextAction}</p>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-2 text-center">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-base font-bold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}
