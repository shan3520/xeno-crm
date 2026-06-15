import type { SegmentDefinition } from "@xeno/shared";

import type { CampaignStatsResponse } from "@/lib/analytics-api";

/**
 * Server-side typed client for the CRM REST API. The /api/chat route and its tools talk to the
 * CRM ONLY through this — never Prisma (web has no DB access). Uses CRM_API_URL (server env);
 * the public NEXT_PUBLIC_CRM_API_URL is for browser callers, which this is not.
 */

const BASE = process.env.CRM_API_URL ?? "http://localhost:3001";

export class CrmApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CrmApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "Unknown error");
    throw new CrmApiError(res.status, `CRM ${path} -> ${res.status}: ${body}`);
  }
  // 201/200 with JSON body; tolerate empty bodies.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A previewed audience: live count + a small sample, computed by the CRM (never the model). */
export interface SegmentPreview {
  count: number;
  sample: unknown[];
}

/** Minimal campaign descriptor the list_campaigns tool exposes to the model (newest first). */
export interface CampaignListItem {
  id: string;
  name: string;
  channel: string;
  status: string;
  launchedAt: string | null;
}

export type ChatRole = "USER" | "ASSISTANT" | "TOOL";
export type AiTaskKind = "SEGMENT_RULE" | "MESSAGE_DRAFT" | "RESULTS_NARRATIVE";

export interface AiTaskLogInput {
  kind: AiTaskKind;
  model: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  input?: unknown;
  output?: unknown;
}

export const crm = {
  /** Validate + count a segment definition against the live audience (field whitelist enforced). */
  segmentPreview(definition: SegmentDefinition): Promise<SegmentPreview> {
    return call<SegmentPreview>("segments/preview", {
      method: "POST",
      body: JSON.stringify({ definition }),
    });
  },

  /** Real funnel stats for one campaign — the ground truth narrate_results is grounded in. */
  campaignStats(campaignId: string): Promise<CampaignStatsResponse> {
    return call<CampaignStatsResponse>(`campaigns/${campaignId}/stats`);
  },

  /** Recent campaigns (newest first) so the model can resolve a name/"my last campaign" to an id. */
  listCampaigns(): Promise<CampaignListItem[]> {
    return call<CampaignListItem[]>("campaigns");
  },

  createThread(title?: string): Promise<{ id: string; title: string | null; createdAt: string }> {
    return call("chat-threads", { method: "POST", body: JSON.stringify({ title }) });
  },

  appendMessages(
    threadId: string,
    messages: Array<{ role: ChatRole; content: unknown }>,
  ): Promise<{ ok: true; count: number }> {
    return call(`chat-threads/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify({ messages }),
    });
  },

  /** Append one row to the AI audit log. Best-effort: callers swallow failures. */
  writeAiTaskLog(payload: AiTaskLogInput): Promise<{ id: string }> {
    return call("ai-task-logs", { method: "POST", body: JSON.stringify(payload) });
  },
};
