"use client";

import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Radio,
  Smartphone,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAnalyticsOverview } from "@/hooks/use-analytics-overview";
import type { CampaignSummaryRow, OverviewResponse } from "@/lib/analytics-api";
import type { CampaignStatus, Channel } from "@xeno/shared";

// ─── Helpers ────────────────────────────────────────────────────────

const STATUS_STYLES: Record<
  CampaignStatus,
  { bg: string; text: string; dot?: string }
> = {
  DRAFT: { bg: "bg-zinc-800/60", text: "text-zinc-400" },
  LAUNCHING: {
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    dot: "animate-pulse",
  },
  SENDING: {
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    dot: "animate-pulse",
  },
  COMPLETED: { bg: "bg-emerald-500/15", text: "text-emerald-400" },
  FAILED: { bg: "bg-red-500/15", text: "text-red-400" },
};

function StatusBadge({ status }: { status: CampaignStatus }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        s.bg,
        s.text,
      )}
    >
      {s.dot && (
        <span className={cn("inline-block h-1.5 w-1.5 rounded-full bg-current", s.dot)} />
      )}
      {status}
    </span>
  );
}

const CHANNEL_ICONS: Record<Channel, typeof Mail> = {
  EMAIL: Mail,
  SMS: Phone,
  WHATSAPP: MessageSquare,
  RCS: Smartphone,
};

function ChannelIcon({ channel }: { channel: Channel }) {
  const Icon = CHANNEL_ICONS[channel] ?? Radio;
  return <Icon className="h-4 w-4 text-muted-foreground" />;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatRevenue(value: string): string {
  const n = parseFloat(value);
  if (isNaN(n) || n === 0) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Overview stat cards ────────────────────────────────────────────

function OverviewStats({ data }: { data: OverviewResponse }) {
  const stats = [
    { label: "Campaigns", value: data.totals.campaigns.toString() },
    { label: "Total Sent", value: data.totals.sent.toLocaleString() },
    {
      label: "Delivery Rate",
      value: pct(data.rates.deliveryRate),
    },
    {
      label: "Open Rate",
      value: pct(data.rates.openRate),
    },
    {
      label: "Click Rate",
      value: pct(data.rates.clickRate),
    },
    {
      label: "Revenue",
      value: formatRevenue(data.totals.attributedRevenue),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl border border-border bg-card/50 px-4 py-3 backdrop-blur-sm"
        >
          <p className="text-xs text-muted-foreground">{s.label}</p>
          <p className="mt-1 text-lg font-semibold tracking-tight">
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Campaign table ─────────────────────────────────────────────────

function CampaignRow({ campaign }: { campaign: CampaignSummaryRow }) {
  const router = useRouter();

  return (
    <tr
      className="group cursor-pointer border-b border-border/50 transition-colors hover:bg-accent/30"
      onClick={() => router.push(`/campaigns/${campaign.id}`)}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <ChannelIcon channel={campaign.channel} />
          <span className="font-medium">{campaign.name}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={campaign.status} />
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
        {campaign.audienceSize.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {campaign.sent.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {campaign.delivered.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
        {pct(campaign.openRate)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {formatRevenue(campaign.attributedRevenue)}
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground">
        {formatDate(campaign.launchedAt)}
      </td>
      <td className="px-4 py-3 text-right">
        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </td>
    </tr>
  );
}

// ─── Loading skeleton ───────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="space-y-6">
      {/* Overview stat skeletons */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card/50 px-4 py-3"
          >
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-5 w-12 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      {/* Table skeletons */}
      <div className="rounded-xl border border-border bg-card/30 overflow-hidden">
        <div className="divide-y divide-border/50">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
              <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
              <div className="ml-auto h-4 w-12 animate-pulse rounded bg-muted" />
              <div className="h-4 w-12 animate-pulse rounded bg-muted" />
              <div className="h-4 w-12 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="rounded-2xl bg-muted/30 p-4">
        <Radio className="h-10 w-10 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-lg font-medium">No campaigns yet</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Campaigns will appear here once they&apos;re created through the AI
        console. Each campaign&apos;s performance will be tracked in real-time.
      </p>
    </div>
  );
}

// ─── Error state ────────────────────────────────────────────────────

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="rounded-2xl bg-red-500/10 p-4">
        <AlertCircle className="h-10 w-10 text-red-400" />
      </div>
      <h3 className="mt-4 text-lg font-medium">Failed to load campaigns</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      <button
        onClick={onRetry}
        className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Retry
      </button>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────

export default function CampaignsPage() {
  const { data, isLoading, isError, error, refetch } = useAnalyticsOverview();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Performance analytics across all campaigns
          </p>
        </div>
        <TableSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
        </div>
        <ErrorState
          message={error instanceof Error ? error.message : "Unknown error"}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (!data || data.campaigns.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Performance analytics across all campaigns
          </p>
        </div>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Performance analytics across all campaigns
          </p>
        </div>
        {data.campaigns.some(
          (c) => c.status === "SENDING" || c.status === "LAUNCHING",
        ) && (
          <div className="flex items-center gap-1.5 text-xs text-blue-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400" />
            Live
          </div>
        )}
      </div>

      {/* Overview stats */}
      <OverviewStats data={data} />

      {/* Campaign table */}
      <div className="rounded-xl border border-border bg-card/30 overflow-hidden backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">
                  Campaign
                </th>
                <th className="px-4 py-3 font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Audience
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Sent
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Delivered
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Open Rate
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Revenue
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Launched
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <CampaignRow key={c.id} campaign={c} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
