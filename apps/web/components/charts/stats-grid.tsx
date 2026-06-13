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
  label: string;
  count: number;
  rate: number;
  rateLabel: string;
  colorVar: string;
  /** When true, the metric doesn't apply to this channel (e.g. opens on SMS). */
  notApplicable?: boolean;
  naLabel?: string;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function StatsGrid({ funnel, rates, channel, className }: StatsGridProps) {
  // SMS has no open-tracking pixel, so the stub never emits an OPENED event for it
  // (see channel-stub lifecycle: supportsOpenTracking = channel !== "SMS"). Showing a
  // dead "0 / 0.0%" reads like a bug; surface "n/a" instead.
  const opensNotApplicable = channel === "SMS";

  const cards: MetricCard[] = [
    {
      label: "Sent",
      count: funnel.sent,
      rate: rates.deliveryRate,
      rateLabel: "delivery",
      colorVar: "var(--chart-1)",
    },
    {
      label: "Delivered",
      count: funnel.delivered,
      rate: rates.deliveryRate,
      rateLabel: "delivery",
      colorVar: "var(--chart-2)",
    },
    {
      label: "Opened",
      count: funnel.opened,
      rate: rates.openRate,
      rateLabel: "open rate",
      colorVar: "var(--chart-3)",
      notApplicable: opensNotApplicable,
      naLabel: "n/a for SMS",
    },
    {
      label: "Clicked",
      count: funnel.clicked,
      rate: rates.clickRate,
      rateLabel: "click rate",
      colorVar: "var(--chart-4)",
    },
  ];

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {cards.map((card) => (
        <div
          key={card.label}
          className="relative overflow-hidden rounded-xl border border-border bg-card/40 p-5 backdrop-blur-sm transition-colors hover:bg-card/60"
        >
          {/* Accent top line */}
          <div
            className="absolute inset-x-0 top-0 h-0.5"
            style={{ backgroundColor: card.colorVar }}
          />

          <p className="text-sm font-medium text-muted-foreground">
            {card.label}
          </p>

          {card.notApplicable ? (
            <>
              <p
                className="mt-2 text-3xl font-bold tracking-tight text-muted-foreground/40"
                style={{ fontVariantNumeric: "tabular-nums" }}
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
              <p
                className="mt-2 text-3xl font-bold tracking-tight text-foreground transition-all duration-500"
                style={{
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatNumber(card.count)}
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                <span
                  className="font-semibold"
                  style={{ color: card.colorVar }}
                >
                  {formatRate(card.rate)}
                </span>{" "}
                {card.rateLabel}
              </p>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
