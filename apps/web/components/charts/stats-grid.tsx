"use client";

import { cn } from "@/lib/utils";
import type { DerivedRates, FunnelCounts } from "@/lib/analytics-api";
import type { Channel } from "@xeno/shared";

interface StatsGridProps {
  funnel: FunnelCounts;
  rates: DerivedRates;
  channel: Channel;
  className?: string;
}

interface MetricCard {
  /** Funnel stage this tile reports. */
  label: string;
  /** The judgment metric — leads the tile. */
  rate: number;
  /** Absolute volume behind the rate — supporting line. */
  count: number;
  countLabel: string;
  /** When true, the metric doesn't apply to this channel (e.g. opens on SMS). */
  notApplicable?: boolean;
  naLabel?: string;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

function formatRate(rate: number): string {
  // Clamp to [0, 100%]: during a live send, out-of-order lifecycle callbacks can briefly make a
  // stage's numerator exceed its denominator (e.g. opened>delivered), which would otherwise render
  // an impossible rate like "127.3%". It reconciles as the lagging callbacks land.
  const clamped = Math.max(0, Math.min(rate, 1));
  return `${(clamped * 100).toFixed(1)}%`;
}

export function StatsGrid({ funnel, rates, channel, className }: StatsGridProps) {
  // This strip is the persistent KPI read across all three tabs: the rate a marketer judges
  // each funnel transition by, with the raw volume as support. The FunnelChart below owns the
  // absolute counts and the drop-off shape, so the two never report the same number as a
  // headline. (Sent is a denominator — it lives in the funnel and the page-header audience.)
  //
  // SMS has no open-tracking pixel, so the stub never emits an OPENED event for it
  // (channel-stub lifecycle: supportsOpenTracking = channel !== "SMS"). A dead "0.0%" reads
  // like a bug; surface "n/a" instead.
  const opensNotApplicable = channel === "SMS";

  const cards: MetricCard[] = [
    {
      label: "Delivered",
      rate: rates.deliveryRate,
      count: funnel.delivered,
      countLabel: "delivered",
    },
    {
      label: "Opened",
      rate: rates.openRate,
      count: funnel.opened,
      countLabel: "opened",
      notApplicable: opensNotApplicable,
      naLabel: "n/a for SMS",
    },
    {
      label: "Clicked",
      rate: rates.clickRate,
      count: funnel.clicked,
      countLabel: "clicked",
    },
    {
      label: "Converted",
      rate: rates.conversionRate,
      count: funnel.converted,
      countLabel: "converted",
    },
  ];

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {cards.map((card, i) => (
        <div
          key={card.label}
          style={{ animationDelay: `${i * 60}ms` }}
          className="msg-in rounded-xl border border-border bg-card/40 p-5 transition duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:bg-card/60 hover:shadow-elevated"
        >
          <p className="text-sm font-medium text-muted-foreground">
            {card.label}
          </p>

          {card.notApplicable ? (
            <>
              <p
                className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-muted-foreground/60"
                title="Open tracking isn't available on SMS"
              >
                —
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {card.naLabel}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-foreground transition-colors duration-500">
                {formatRate(card.rate)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground/80">
                  {formatNumber(card.count)}
                </span>{" "}
                {card.countLabel}
              </p>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
