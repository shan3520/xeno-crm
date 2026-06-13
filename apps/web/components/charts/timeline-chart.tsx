"use client";

import { cn } from "@/lib/utils";
import type { TimelineBucket } from "@/lib/analytics-api";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Payload } from "recharts/types/component/DefaultTooltipContent";

interface CustomTooltipPayload {
  active?: boolean;
  payload?: Payload<number, string>[];
  label?: string;
}

interface TimelineChartProps {
  data: TimelineBucket[];
  className?: string;
}

interface EventConfig {
  key: keyof Omit<TimelineBucket, "bucket">;
  label: string;
  color: string;
}

const EVENTS: EventConfig[] = [
  { key: "sent", label: "Sent", color: "var(--chart-1)" },
  { key: "delivered", label: "Delivered", color: "var(--chart-2)" },
  { key: "opened", label: "Opened", color: "var(--chart-3)" },
  { key: "clicked", label: "Clicked", color: "var(--chart-4)" },
  { key: "failed", label: "Failed", color: "var(--destructive)" },
];

function formatTimestamp(bucket: string, isShortDuration: boolean): string {
  try {
    const date = new Date(bucket);
    if (isShortDuration) {
      return date.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return date.toLocaleDateString("en-IN", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return bucket;
  }
}

function isShortDuration(data: TimelineBucket[]): boolean {
  if (data.length < 2) return true;
  try {
    const first = new Date(data[0].bucket).getTime();
    const last = new Date(data[data.length - 1].bucket).getTime();
    const diffHours = (last - first) / (1000 * 60 * 60);
    return diffHours <= 24;
  } catch {
    return true;
  }
}

function CustomTooltip({
  active,
  payload,
  label,
}: CustomTooltipPayload) {
  if (!active || !payload || payload.length === 0) return null;

  let formattedLabel: string;
  try {
    formattedLabel = new Date(label as string).toLocaleString("en-IN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    formattedLabel = String(label);
  }

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-elevated">
      <p className="mb-1 text-xs text-muted-foreground">{formattedLabel}</p>
      {payload.map((entry) => (
        <div
          key={String(entry.name)}
          className="flex items-center gap-2 text-xs"
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}</span>
          <span className="ml-auto font-medium text-foreground">
            {new Intl.NumberFormat("en-IN").format(Number(entry.value ?? 0))}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TimelineChart({ data, className }: TimelineChartProps) {
  if (!data || data.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-[300px] items-center justify-center rounded-xl border border-border bg-card/40 p-5 backdrop-blur-sm",
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">
          No timeline data available
        </p>
      </div>
    );
  }

  const shortDuration = isShortDuration(data);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card/40 p-5 backdrop-blur-sm",
        className,
      )}
    >
      <h3 className="mb-4 text-sm font-medium text-muted-foreground">
        Event Timeline
      </h3>

      {/* Legend */}
      <div className="mb-3 flex flex-wrap gap-4">
        {EVENTS.map((event) => (
          <div key={event.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: event.color }}
            />
            <span className="text-xs text-muted-foreground">
              {event.label}
            </span>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart
          data={data}
          margin={{ top: 5, right: 10, bottom: 0, left: 0 }}
        >
          <defs>
            {EVENTS.map((event) => (
              <linearGradient
                key={event.key}
                id={`gradient-${event.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="5%" stopColor={event.color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={event.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="bucket"
            tickFormatter={(v: string) => formatTimestamp(v, shortDuration)}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} />
          {EVENTS.map((event) => (
            <Area
              key={event.key}
              type="monotone"
              dataKey={event.key}
              name={event.label}
              stackId="1"
              stroke={event.color}
              fill={`url(#gradient-${event.key})`}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
