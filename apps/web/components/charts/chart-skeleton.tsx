import { cn } from "@/lib/utils";

/**
 * Loading placeholder for a lazily-loaded Recharts chart. Deliberately recharts-free so it
 * stays in the light initial bundle and can render instantly while the chart chunk streams in.
 * Mirrors the chart card wrapper (border, bg-card/40, p-5, title) and reserves the plot height
 * so swapping in the real chart causes no layout shift (CLS).
 */
export function ChartSkeleton({
  height = 320,
  label,
  className,
}: {
  height?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-card/40 p-5", className)}
      aria-hidden="true"
    >
      {label ? (
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">{label}</h2>
      ) : (
        <div className="mb-4 h-4 w-32 animate-pulse rounded bg-muted" />
      )}
      <div
        className="animate-pulse rounded-lg bg-muted/30"
        style={{ height }}
      />
    </div>
  );
}
