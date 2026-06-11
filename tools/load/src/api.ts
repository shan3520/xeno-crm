import type { SegmentDefinition } from "@xeno/shared";

/**
 * Thin typed client over the crm-api public REST surface. The harness drives the system
 * ONLY through these endpoints — it never writes load data to the DB directly. Response
 * shapes are declared as the subset the harness consumes (kept deliberately loose so the
 * harness is not coupled to the full DTOs).
 */

export interface SegmentPreviewResult {
  count: number;
}

export interface SegmentCreateResult {
  id: string;
}

export interface CampaignResult {
  id: string;
  status: string;
  audienceSize: number;
  counters: {
    queued: number;
    sent: number;
    delivered: number;
    failed: number;
    opened: number;
    read: number;
    clicked: number;
    converted: number;
  };
  attributedRevenue: string;
}

export interface LaunchResult extends CampaignResult {
  skippedNoAddress: number;
}

export interface CampaignStats {
  campaign: { status: string; audienceSize: number };
  funnel: {
    queued: number;
    sent: number;
    delivered: number;
    opened: number;
    read: number;
    clicked: number;
    converted: number;
    failed: number;
  };
  attributedRevenue: string;
}

export class ApiError extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} ${url} -> ${status}: ${body.slice(0, 300)}`);
    this.name = "ApiError";
  }
}

export class CrmApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new ApiError(method, url, res.status, text);
      }
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`${method} ${url} failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }

  health(): Promise<{ status: string; service: string }> {
    return this.request("GET", "/health");
  }

  previewSegment(definition: SegmentDefinition): Promise<SegmentPreviewResult> {
    return this.request("POST", "/segments/preview", { definition });
  }

  createSegment(input: {
    name: string;
    description?: string;
    definition: SegmentDefinition;
  }): Promise<SegmentCreateResult> {
    return this.request("POST", "/segments", { ...input, origin: "AI" });
  }

  createCampaign(input: {
    name: string;
    goal: string;
    segmentId: string;
    channel: string;
    messageTemplate: string;
  }): Promise<CampaignResult> {
    return this.request("POST", "/campaigns", input);
  }

  launchCampaign(id: string): Promise<LaunchResult> {
    return this.request("POST", `/campaigns/${id}/launch`);
  }

  campaignStats(id: string): Promise<CampaignStats> {
    return this.request("GET", `/campaigns/${id}/stats`);
  }
}

/** Probe a base URL's /health, returning a readable error rather than throwing fetch noise. */
export async function probeHealth(
  baseUrl: string,
  timeoutMs: number,
): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const json = (await res.json()) as { service?: string };
    return { ok: true, detail: json.service ?? "ok" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: reason };
  } finally {
    clearTimeout(timer);
  }
}
