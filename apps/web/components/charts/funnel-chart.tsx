"use client";

import { cn } from "@/lib/utils";
import type { FunnelCounts } from "@/lib/analytics-api";
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

interface FunnelChartProps {
  funnel: FunnelCounts;
  className?: string;
}

interface FunnelDatum {
  stage: string;
  value: number;
  color: string;
}

export function FunnelChart({ funnel, className }: FunnelChartProps) {
  // Color carries meaning here, not decoration. The healthy pipeline shares one calm hue —
  // the drop-off is read from bar length, so the in-between stages don't need separate colors.
  // Only the two outcomes that matter earn their own: Converted (the win) and Failed (the loss).
  const data: FunnelDatum[] = [
    { stage: "Queued", value: funnel.queued, color: "var(--chart-1)" },
    { stage: "Sent", value: funnel.sent, color: "var(--chart-1)" },
    { stage: "Delivered", value: funnel.delivered, color: "var(--chart-1)" },
    { stage: "Opened", value: funnel.opened, color: "var(--chart-1)" },
    { stage: "Read", value: funnel.read, color: "var(--chart-1)" },
    { stage: "Clicked", value: funnel.clicked, color: "var(--chart-1)" },
    { stage: "Converted", value: funnel.converted, color: "var(--launch)" },
    { stage: "Failed", value: funnel.failed, color: "var(--destructive)" },
  ];

  const isEmpty = data.every((d) => d.value === 0);

  const nf = new Intl.NumberFormat("en-IN");
  const summary = `Delivery funnel. ${data
    .map((d) => `${d.stage}: ${nf.format(d.value)}`)
    .join(", ")}.`;

  if (isEmpty) {
    return (
      <div
        className={cn(
          "flex min-h-[300px] items-center justify-center rounded-xl border border-border bg-card/40 p-5",
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">No data yet</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card/40 p-5",
        className,
      )}
    >
      <h2 className="mb-4 text-sm font-medium text-muted-foreground">
        Delivery funnel
      </h2>
      {/* The SVG carries no accessible text; expose the figures as one labeled image. */}
      <div role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 60, bottom: 0, left: 80 }}
        >
          <CartesianGrid
            horizontal={false}
            strokeDasharray="3 3"
            stroke="var(--border)"
          />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="stage"
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={70}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={24}>
            {data.map((entry) => (
              <Cell key={entry.stage} fill={entry.color} />
            ))}
            <LabelList
              dataKey="value"
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
    </div>
  );
}
