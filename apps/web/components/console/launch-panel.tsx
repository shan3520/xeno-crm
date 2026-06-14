"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Rocket,
  ShieldAlert,
} from "lucide-react";

import { channelMeta } from "@/components/console/channel-meta";
import type { ActiveSegment } from "@/components/console/segment-rule-card";
import type { ActiveMessage } from "@/components/console/message-draft-card";
import {
  createCampaign,
  launchCampaign,
  type LaunchResult,
} from "@/lib/analytics-api";

interface Props {
  segment: ActiveSegment;
  message: ActiveMessage;
}

type Phase = "idle" | "confirming" | "launching" | "launched" | "error";

export function LaunchPanel({ segment, message }: Props) {
  const [name, setName] = useState(segment.name);
  const [goal, setGoal] = useState(
    segment.description?.trim() || `Re-engage ${segment.name}`,
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [launched, setLaunched] = useState<LaunchResult | null>(null);

  const meta = channelMeta(message.channel);
  const ChannelIcon = meta.icon;
  const audience = segment.count;

  async function confirmLaunch() {
    setPhase("launching");
    setErrorMsg(null);
    try {
      const draft = await createCampaign({
        name: name.trim() || segment.name,
        goal: goal.trim() || `Re-engage ${segment.name}`,
        channel: message.channel,
        messageTemplate: message.body,
        definition: segment.definition,
      });
      const result = await launchCampaign(draft.id);
      setLaunched(result);
      setPhase("launched");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Launch failed. Please retry.",
      );
      setPhase("error");
    }
  }

  // ─── Success state ────────────────────────────────────────────────
  if (phase === "launched" && launched) {
    return (
      <div className="overflow-hidden rounded-2xl border border-launch/30 bg-launch/5 shadow-elevated">
        <div className="flex flex-col items-start gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-launch/15 p-2.5">
              <CheckCircle2 className="h-6 w-6 text-launch" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">
                Campaign launched
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {launched.audienceSize.toLocaleString()} {meta.label} messages
                queued and now sending
                {launched.skippedNoAddress > 0
                  ? ` · ${launched.skippedNoAddress.toLocaleString()} skipped (no address)`
                  : ""}
                .
              </p>
            </div>
          </div>
          <Link
            href={`/campaigns/${launched.id}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-launch px-4 py-2 text-sm font-medium text-background transition hover:bg-launch/90 active:scale-[0.98]"
          >
            View live dashboard
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  // ─── Compose / confirm state ──────────────────────────────────────
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/40 shadow-elevated">
      <div className="flex items-center gap-2 border-b border-border/60 bg-gradient-to-br from-launch/10 to-transparent px-5 py-4">
        <Rocket className="h-4 w-4 text-launch" />
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          Review &amp; launch
        </h3>
      </div>

      <div className="space-y-4 px-5 py-4">
        {/* Final summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Summary label="Audience">
            <span className="text-lg font-bold tabular-nums text-foreground">
              {audience.toLocaleString()}
            </span>
          </Summary>
          <Summary label="Channel">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              <ChannelIcon className="h-4 w-4" />
              {meta.label}
            </span>
          </Summary>
          <Summary label="Message">
            <span className="text-sm text-foreground">
              {message.body.length} chars
            </span>
          </Summary>
        </div>

        {/* Editable name + goal */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Campaign name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={phase === "launching"}
              className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Goal
            </span>
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              disabled={phase === "launching"}
              className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            />
          </label>
        </div>

        {errorMsg && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {errorMsg}
          </div>
        )}

        {/* Gated confirm */}
        {phase === "confirming" ? (
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-sm text-foreground/90">
                This will queue{" "}
                <strong className="font-semibold">
                  {audience.toLocaleString()} {meta.label}
                </strong>{" "}
                messages and start sending immediately. This can&apos;t be undone.
              </p>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={confirmLaunch}
                className="inline-flex items-center gap-1.5 rounded-lg bg-launch px-4 py-2 text-sm font-semibold text-background transition hover:bg-launch/90 active:scale-[0.98]"
              >
                <Rocket className="h-4 w-4" />
                Confirm &amp; launch
              </button>
              <button
                onClick={() => setPhase("idle")}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.98]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setPhase("confirming")}
            disabled={phase === "launching"}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-launch px-4 py-2.5 text-sm font-semibold text-background transition hover:bg-launch/90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {phase === "launching" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Launching…
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4" />
                Launch campaign
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function Summary({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
