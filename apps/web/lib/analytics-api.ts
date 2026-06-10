import type { CampaignStatus, Channel } from "@xeno/shared";

// ─── Response types (mirrors CRM API contract) ─────────────────────

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
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  conversionRate: number;
}

export interface FailureEntry {
  reason: string;
  count: number;
}

export interface TimelineBucket {
  bucket: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
}

export interface CampaignStatsResponse {
  campaign: CampaignMeta;
  funnel: FunnelCounts;
  rates: DerivedRates;
  attributedRevenue: string;
  failureBreakdown: FailureEntry[];
  timeline: TimelineBucket[];
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

export interface OverviewResponse {
  totals: OverviewTotals;
  rates: DerivedRates;
  campaigns: CampaignSummaryRow[];
}

// ─── API client ─────────────────────────────────────────────────────

const API_BASE =
  process.env.NEXT_PUBLIC_CRM_API_URL ?? "http://localhost:3001";

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "Unknown error");
    throw new ApiError(res.status, body);
  }

  return res.json() as Promise<T>;
}

export function fetchCampaignStats(
  campaignId: string,
): Promise<CampaignStatsResponse> {
  return get<CampaignStatsResponse>(`campaigns/${campaignId}/stats`);
}

export function fetchAnalyticsOverview(): Promise<OverviewResponse> {
  return get<OverviewResponse>("analytics/overview");
}
