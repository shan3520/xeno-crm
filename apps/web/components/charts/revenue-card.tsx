"use client";

import { cn } from "@/lib/utils";
import { IndianRupee, TrendingUp } from "lucide-react";

interface RevenueCardProps {
  revenue: string;
  conversionRate: number;
  converted: number;
  className?: string;
}

function formatCurrency(value: string): string {
  try {
    const num = parseFloat(value);
    if (isNaN(num)) return "₹0";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `₹${value}`;
  }
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function RevenueCard({
  revenue,
  conversionRate,
  converted,
  className,
}: RevenueCardProps) {
  const revenueNum = parseFloat(revenue);
  const hasRevenue = !isNaN(revenueNum) && revenueNum > 0;

  return (
    // One accent carries this card: the launch-colored figure (and its icon chip). The
    // surface stays bg-card/40 to match the funnel card it sits beside in the overview grid.
    <div className={cn("rounded-xl border border-border bg-card/40 p-5", className)}>
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            hasRevenue
              ? "bg-launch/15 text-launch"
              : "bg-muted text-muted-foreground",
          )}
        >
          <IndianRupee className="h-4 w-4" aria-hidden="true" />
        </div>
        <h2 className="text-sm font-medium text-muted-foreground">
          Attributed Revenue
        </h2>
      </div>

      {/* Revenue amount */}
      <p
        className={cn(
          "text-3xl font-bold tracking-tight transition-colors duration-500",
          hasRevenue ? "text-launch" : "text-foreground",
        )}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {formatCurrency(revenue)}
      </p>

      {/* Metrics row */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp
            className={cn(
              "h-3.5 w-3.5",
              hasRevenue ? "text-launch" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
          <span className="text-sm text-muted-foreground">
            <span
              className={cn(
                "font-semibold",
                hasRevenue ? "text-launch" : "text-foreground",
              )}
            >
              {formatRate(conversionRate)}
            </span>{" "}
            conversion
          </span>
        </div>
        <div className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">
            {new Intl.NumberFormat("en-IN").format(converted)}
          </span>{" "}
          converted
        </div>
      </div>
    </div>
  );
}
