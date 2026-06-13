import type {
  CampaignStatus,
  Channel,
  SegmentDefinition,
} from "@xeno/shared";

import type { SampleCustomer } from "@/lib/ai/tool-results";

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

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new ApiError(res.status, text);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export { ApiError };

export function fetchCampaignStats(
  campaignId: string,
): Promise<CampaignStatsResponse> {
  return get<CampaignStatsResponse>(`campaigns/${campaignId}/stats`);
}

export function fetchAnalyticsOverview(): Promise<OverviewResponse> {
  return get<OverviewResponse>("analytics/overview");
}

export interface HealthResponse {
  status: string;
  service?: string;
}

/**
 * Ping crm-api's /health. Used by the cold-start banner both to DETECT a sleeping free-tier
 * backend (the request hangs ~50s while Render wakes, or 5xx's mid-wake) and to TRIGGER the
 * wake-up just by loading the app. Resolves to { status: "ok" } once the service is warm.
 */
export function fetchCrmHealth(): Promise<HealthResponse> {
  return get<HealthResponse>("health");
}

// ─── Console mutations (segment preview · create · launch) ──────────
// These are the browser-side calls the console makes directly: re-pricing an edited segment
// rule, and the gated create+launch. The AI never writes — the user confirms, the UI calls.

export interface SegmentPreviewResult {
  count: number;
  sample: SampleCustomer[];
}

/** Re-evaluate an (edited) segment definition for a live count + fresh sample. */
export function previewSegment(
  definition: SegmentDefinition,
): Promise<SegmentPreviewResult> {
  return post<SegmentPreviewResult>("segments/preview", { definition });
}

export interface CampaignCreateInput {
  name: string;
  goal: string;
  channel: Channel;
  messageTemplate: string;
  definition: SegmentDefinition;
}

export interface CampaignResponse {
  id: string;
  name: string;
  goal: string;
  channel: Channel;
  status: CampaignStatus;
  audienceSize: number;
  launchedAt: string | null;
}

/** Create a DRAFT campaign from the reviewed segment + channel + message. */
export function createCampaign(
  input: CampaignCreateInput,
): Promise<CampaignResponse> {
  return post<CampaignResponse>("campaigns", input);
}

export interface LaunchResult extends CampaignResponse {
  skippedNoAddress: number;
}

/** Freeze the audience and flip the campaign to SENDING. The only launch path in the UI. */
export function launchCampaign(campaignId: string): Promise<LaunchResult> {
  return post<LaunchResult>(`campaigns/${campaignId}/launch`);
}
