"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
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
  DRAFT: { bg: "bg-muted", text: "text-muted-foreground" },
  LAUNCHING: {
    bg: "bg-brand/15",
    text: "text-brand",
    dot: "animate-pulse",
  },
  SENDING: {
    bg: "bg-brand/15",
    text: "text-brand",
    dot: "animate-pulse",
  },
  COMPLETED: { bg: "bg-launch/15", text: "text-launch" },
  FAILED: { bg: "bg-destructive/15", text: "text-destructive-foreground" },
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
  return <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
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
          className="rounded-xl border border-border bg-card/50 px-4 py-3 transition-colors hover:border-border/80 hover:bg-card/70"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {s.label}
          </p>
          <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
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
        <div className="flex min-w-0 items-center gap-2">
          <ChannelIcon channel={campaign.channel} />
          {/* The real, keyboard-reachable navigation. The row onClick is a mouse-only
              convenience layered on top; stopPropagation avoids a redundant double-push. */}
          <Link
            href={`/campaigns/${campaign.id}`}
            onClick={(e) => e.stopPropagation()}
            title={campaign.name}
            className="max-w-[14rem] truncate font-medium text-foreground transition-colors hover:text-brand sm:max-w-xs"
          >
            {campaign.name}
          </Link>
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
        {campaign.channel === "SMS" ? (
          <span title="Open tracking isn't available on SMS">n/a</span>
        ) : (
          pct(campaign.openRate)
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {formatRevenue(campaign.attributedRevenue)}
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground">
        {formatDate(campaign.launchedAt)}
      </td>
      <td className="px-4 py-3 text-right">
        <ArrowRight
          className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </td>
    </tr>
  );
}

// ─── Campaign card (small screens) ──────────────────────────────────
// The 8-column table can't survive a phone, so below md the same rows reflow to a
// stacked, fully-tappable card: identity + status up top, the four headline metrics in
// a 2x2 grid, audience and launch date as footer meta. No column scrolls off-screen.

function CardStat({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 truncate tabular-nums",
          muted ? "text-muted-foreground" : "font-medium text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: CampaignSummaryRow }) {
  const isSms = campaign.channel === "SMS";
  return (
    <Link
      href={`/campaigns/${campaign.id}`}
      className="block rounded-xl border border-border bg-card/40 p-4 transition-colors hover:bg-card/60 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ChannelIcon channel={campaign.channel} />
          <span className="truncate font-medium text-foreground">
            {campaign.name}
          </span>
        </div>
        <StatusBadge status={campaign.status} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <CardStat label="Sent" value={campaign.sent.toLocaleString()} />
        <CardStat label="Delivered" value={campaign.delivered.toLocaleString()} />
        <CardStat
          label="Open rate"
          value={isSms ? "n/a" : pct(campaign.openRate)}
          muted={isSms}
        />
        <CardStat label="Revenue" value={formatRevenue(campaign.attributedRevenue)} />
      </dl>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/50 pt-2.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {campaign.audienceSize.toLocaleString()} audience
        </span>
        <span className="shrink-0 tabular-nums">
          {formatDate(campaign.launchedAt)}
        </span>
      </div>
    </Link>
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
      {/* Card skeletons (small screens) */}
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card/40 p-4">
            <div className="flex items-center justify-between">
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
              <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j}>
                  <div className="h-2.5 w-12 animate-pulse rounded bg-muted" />
                  <div className="mt-1.5 h-4 w-16 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Table skeletons (md and up) */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card/30 md:block">
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
        <Radio className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-lg font-medium">No campaigns yet</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Describe an audience in the console and launch your first campaign. Its
        delivery and conversion show up here as messages send.
      </p>
      <Link
        href="/console"
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98]"
      >
        Open the console
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
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
      <div className="rounded-2xl bg-destructive/10 p-4">
        <AlertCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-lg font-medium">Failed to load campaigns</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      <button
        onClick={onRetry}
        className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98]"
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
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Delivery and conversion for every campaign you&apos;ve launched
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
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
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
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Delivery and conversion for every campaign you&apos;ve launched
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
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Delivery and conversion for every campaign you&apos;ve launched
          </p>
        </div>
        {data.campaigns.some(
          (c) => c.status === "SENDING" || c.status === "LAUNCHING",
        ) && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-brand">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" />
            Live
          </div>
        )}
      </div>

      {/* Overview stats */}
      <OverviewStats data={data} />

      {/* Campaign list — stacked cards on small screens, dense table from md up */}
      <div className="space-y-3 md:hidden">
        {data.campaigns.map((c) => (
          <CampaignCard key={c.id} campaign={c} />
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card/30 md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                  Campaign
                </th>
                <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Audience
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Sent
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Delivered
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Open Rate
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Revenue
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Launched
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Open campaign</span>
                </th>
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
