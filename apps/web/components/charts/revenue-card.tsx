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
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border p-6 backdrop-blur-sm",
        hasRevenue
          ? "bg-gradient-to-br from-emerald-950/40 to-zinc-900/50"
          : "bg-zinc-900/50",
        className,
      )}
    >
      {/* Subtle glow effect */}
      {hasRevenue && (
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-emerald-500/10 blur-2xl" />
      )}

      <div className="relative">
        {/* Header */}
        <div className="mb-4 flex items-center gap-2">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              hasRevenue
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-zinc-800 text-muted-foreground",
            )}
          >
            <IndianRupee className="h-4 w-4" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            Attributed Revenue
          </p>
        </div>

        {/* Revenue amount */}
        <p
          className={cn(
            "text-3xl font-bold tracking-tight transition-all duration-500",
            hasRevenue ? "text-emerald-400" : "text-foreground",
          )}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {formatCurrency(revenue)}
        </p>

        {/* Metrics row */}
        <div className="mt-4 flex items-center gap-6">
          <div className="flex items-center gap-1.5">
            <TrendingUp
              className={cn(
                "h-3.5 w-3.5",
                hasRevenue ? "text-emerald-400" : "text-muted-foreground",
              )}
            />
            <span className="text-sm text-muted-foreground">
              <span
                className={cn(
                  "font-semibold",
                  hasRevenue ? "text-emerald-400" : "text-foreground",
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
    </div>
  );
}
