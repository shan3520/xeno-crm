"use client";

import { useParams } from "next/navigation";
import { useRef, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Radio,
  Smartphone,
} from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { useCampaignStats } from "@/hooks/use-campaign-stats";
import { StatsGrid } from "@/components/charts/stats-grid";
import { RevenueCard } from "@/components/charts/revenue-card";
import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import type { CampaignStatus, Channel } from "@xeno/shared";

// Recharts is ~120 kB and only ever renders client-side (the page is client-rendered and the
// charts measure the DOM via ResponsiveContainer). Splitting it into a lazy chunk keeps it out
// of the route's initial bundle: the header + StatsGrid (the headline numbers) paint and become
// interactive immediately, the funnel streams in behind a same-size skeleton (no layout shift),
// and the Timeline/Failure chunks aren't fetched at all until their tab is opened.
const FunnelChart = dynamic(
  () => import("@/components/charts/funnel-chart").then((m) => m.FunnelChart),
  { ssr: false, loading: () => <ChartSkeleton height={320} label="Delivery funnel" /> },
);
const TimelineChart = dynamic(
  () => import("@/components/charts/timeline-chart").then((m) => m.TimelineChart),
  { ssr: false, loading: () => <ChartSkeleton height={300} label="Event timeline" /> },
);
const FailureChart = dynamic(
  () => import("@/components/charts/failure-chart").then((m) => m.FailureChart),
  { ssr: false, loading: () => <ChartSkeleton height={240} label="Failure breakdown" /> },
);

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
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
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

const CHANNEL_META: Record<Channel, { icon: typeof Mail; label: string }> = {
  EMAIL: { icon: Mail, label: "Email" },
  SMS: { icon: Phone, label: "SMS" },
  WHATSAPP: { icon: MessageSquare, label: "WhatsApp" },
  RCS: { icon: Smartphone, label: "RCS" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "Not launched";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Tabs ───────────────────────────────────────────────────────────

type Tab = "overview" | "timeline" | "failures";

// ─── Loading skeleton ───────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="space-y-3">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-7 w-64 animate-pulse rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
          <div className="h-6 w-16 animate-pulse rounded-full bg-muted" />
        </div>
      </div>
      {/* Stats grid skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card/50 p-5">
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-8 w-20 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      {/* Chart skeleton */}
      <div className="rounded-xl border border-border bg-card/30 p-6">
        <div className="h-64 animate-pulse rounded-lg bg-muted/30" />
      </div>
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
      <h3 className="mt-4 text-lg font-medium">
        Failed to load campaign stats
      </h3>
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

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const { data, isLoading, isError, error, refetch, isFetching } =
    useCampaignStats(campaignId);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const isLive =
    data?.campaign.status === "SENDING" ||
    data?.campaign.status === "LAUNCHING";

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All campaigns
        </Link>
        <DetailSkeleton />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All campaigns
        </Link>
        <ErrorState
          message={error instanceof Error ? error.message : "Unknown error"}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  const { campaign, funnel, rates, timeline, failureBreakdown } = data;
  const channelMeta = CHANNEL_META[campaign.channel] ?? {
    icon: Radio,
    label: campaign.channel,
  };
  const ChannelIcon = channelMeta.icon;

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "timeline", label: "Timeline" },
    {
      id: "failures",
      label: `Failures${funnel.failed > 0 ? ` (${funnel.failed})` : ""}`,
    },
  ];

  // WAI-ARIA tabs: roving tabindex with arrow/Home/End, focus follows selection.
  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    setActiveTab(tabs[next].id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All campaigns
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {campaign.name}
          </h1>
          <p className="text-sm text-muted-foreground">{campaign.goal}</p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={campaign.status} />
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
              <ChannelIcon className="h-3 w-3" aria-hidden="true" />
              {channelMeta.label}
            </span>
            <span className="text-xs text-muted-foreground">
              Audience: {campaign.audienceSize.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">
              · Launched: {formatDate(campaign.launchedAt)}
            </span>
          </div>
        </div>

        {/* Live indicator */}
        <div className="flex items-center gap-2">
          {isLive && (
            <div className="flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" />
              Live
            </div>
          )}
          {isFetching && !isLoading && (
            <Loader2
              className="h-4 w-4 animate-spin text-muted-foreground"
              aria-label="Refreshing stats"
            />
          )}
        </div>
      </div>

      {/* Stats grid */}
      <StatsGrid funnel={funnel} rates={rates} channel={campaign.channel} />

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Campaign analytics views"
        className="flex gap-1 rounded-lg bg-muted/30 p-1"
      >
        {tabs.map((t, i) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveTab(t.id)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition active:scale-[0.98]",
                active
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <div
          role="tabpanel"
          id="panel-overview"
          aria-labelledby="tab-overview"
          tabIndex={0}
          className="grid gap-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:grid-cols-3"
        >
          <div className="lg:col-span-2">
            <FunnelChart funnel={funnel} />
          </div>
          <div>
            <RevenueCard
              revenue={data.attributedRevenue}
              conversionRate={rates.conversionRate}
              converted={funnel.converted}
            />
          </div>
        </div>
      )}

      {activeTab === "timeline" && (
        <div
          role="tabpanel"
          id="panel-timeline"
          aria-labelledby="tab-timeline"
          tabIndex={0}
          className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <TimelineChart data={timeline} />
        </div>
      )}

      {activeTab === "failures" && (
        <div
          role="tabpanel"
          id="panel-failures"
          aria-labelledby="tab-failures"
          tabIndex={0}
          className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <FailureChart data={failureBreakdown} />
        </div>
      )}
    </div>
  );
}
