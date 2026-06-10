import type { CampaignStatus, Channel } from "@xeno/shared";

// ─── GET /campaigns/:id/stats ─────────────────────────────────────────

export interface CampaignStatsResponse {
  campaign: CampaignMeta;
  funnel: FunnelCounts;
  rates: DerivedRates;
  attributedRevenue: string; // Decimal serialised as string
  failureBreakdown: FailureEntry[];
  timeline: TimelineBucket[];
}

export interface CampaignMeta {
  id: string;
  name: string;
  goal: string;
  channel: Channel;
  status: CampaignStatus;
  audienceSize: number;
  launchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FunnelCounts {
  queued: number;
  sent: number;
  delivered: number;
  opened: number;
  read: number;
  clicked: number;
  converted: number;
  failed: number;
}

export interface DerivedRates {
  /** delivered / sent */
  deliveryRate: number;
  /** opened / delivered */
  openRate: number;
  /** clicked / opened */
  clickRate: number;
  /** converted / delivered */
  conversionRate: number;
}

export interface FailureEntry {
  reason: string;
  count: number;
}

export interface TimelineBucket {
  /** ISO-8601 timestamp of the bucket start */
  bucket: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
}

// ─── GET /analytics/overview ──────────────────────────────────────────

export interface OverviewResponse {
  totals: OverviewTotals;
  rates: DerivedRates;
  campaigns: CampaignSummaryRow[];
}

export interface OverviewTotals {
  campaigns: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  converted: number;
  failed: number;
  attributedRevenue: string;
}

export interface CampaignSummaryRow {
  id: string;
  name: string;
  channel: Channel;
  status: CampaignStatus;
  audienceSize: number;
  launchedAt: string | null;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  converted: number;
  failed: number;
  attributedRevenue: string;
  deliveryRate: number;
  openRate: number;
}
