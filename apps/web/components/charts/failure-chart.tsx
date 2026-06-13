"use client";

import { cn } from "@/lib/utils";
import type { FailureEntry } from "@/lib/analytics-api";
import { CheckCircle2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

interface FailureChartProps {
  data: FailureEntry[];
  className?: string;
}

const FAILURE_COLORS = [
  "hsl(0 84% 60%)",
  "hsl(15 80% 55%)",
  "hsl(30 80% 50%)",
  "hsl(45 80% 50%)",
  "hsl(350 80% 55%)",
];

export function FailureChart({ data, className }: FailureChartProps) {
  const hasFailures = data && data.length > 0;

  if (!hasFailures) {
    return (
      <div
        className={cn(
          "flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card/40 p-5 backdrop-blur-sm",
          className,
        )}
      >
        <CheckCircle2 className="h-10 w-10 text-launch" />
        <p className="text-sm font-medium text-launch">
          All messages processed successfully
        </p>
      </div>
    );
  }

  // Truncate long reasons for display
  const chartData = data.map((entry) => ({
    reason:
      entry.reason.length > 30
        ? `${entry.reason.slice(0, 27)}...`
        : entry.reason,
    count: entry.count,
    fullReason: entry.reason,
  }));

  const dynamicHeight = Math.max(200, chartData.length * 45 + 40);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card/40 p-5 backdrop-blur-sm",
        className,
      )}
    >
      <h3 className="mb-4 text-sm font-medium text-muted-foreground">
        Failure Breakdown
      </h3>
      <ResponsiveContainer width="100%" height={dynamicHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 60, bottom: 0, left: 120 }}
        >
          <CartesianGrid
            horizontal={false}
            strokeDasharray="3 3"
            stroke="var(--border)"
          />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="reason"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={110}
          />
          <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={20}>
            {chartData.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill={FAILURE_COLORS[index % FAILURE_COLORS.length]}
              />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              fill="var(--muted-foreground)"
              fontSize={12}
              formatter={(v: string | number | boolean | null | undefined) =>
                new Intl.NumberFormat("en-IN").format(Number(v))
              }
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
