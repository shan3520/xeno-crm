"use client";

import { Clock, ShieldX, TriangleAlert } from "lucide-react";

import type { ToolFailure } from "@/lib/ai/tool-results";

/**
 * Renders a tool's typed degraded result inline — most importantly a rate-limited turn, which
 * must surface as a friendly "model busy, retry" state rather than a blank crash.
 */
export function ToolFailureCard({
  failure,
  onRetry,
}: {
  failure: ToolFailure;
  onRetry?: () => void;
}) {
  const rateLimited = failure.error === "rate_limited";
  const Icon = rateLimited
    ? Clock
    : failure.error === "validation_failed"
      ? ShieldX
      : TriangleAlert;

  const title = rateLimited
    ? "The model is busy"
    : failure.error === "validation_failed"
      ? "That rule didn’t pass validation"
      : "Something went wrong";

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-amber-500/15 p-2">
          <Icon className="h-4 w-4 text-amber-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {failure.message}
          </p>
          {rateLimited && onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 rounded-lg border border-border bg-background/50 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
