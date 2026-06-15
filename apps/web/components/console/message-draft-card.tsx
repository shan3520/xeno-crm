"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Eye, MessageSquareText, Sparkles } from "lucide-react";
import type { Channel } from "@xeno/shared";

import { cn } from "@/lib/utils";
import { channelMeta } from "@/components/console/channel-meta";
import type { DraftMessageSuccess, SampleCustomer } from "@/lib/ai/tool-results";
import { MESSAGE_TOKENS, renderSpans } from "@/lib/tokens";

/** The consolidated, possibly-edited message the console hands to the LaunchPanel. */
export interface ActiveMessage {
  toolCallId: string;
  channel: Channel;
  body: string;
}

interface Props {
  toolCallId: string;
  result: DraftMessageSuccess;
  /** A real audience member for the live token preview (from the active segment). */
  sampleCustomer?: SampleCustomer;
  onActive: (message: ActiveMessage) => void;
}

export function MessageDraftCard({
  toolCallId,
  result,
  sampleCustomer,
  onActive,
}: Props) {
  const [body, setBody] = useState(result.body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    onActive({ toolCallId, channel: result.channel, body });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  const meta = channelMeta(result.channel);
  const ChannelIcon = meta.icon;
  const isShortForm = result.channel === "SMS";

  const previewCustomer = sampleCustomer ?? {
    firstName: "Asha",
    lastName: "Rao",
    email: "asha@example.com",
    phone: "+91 90000 00000",
    attributes: { city: "Mumbai", tier: "Gold" },
  };
  const spans = renderSpans(body, previewCustomer);
  // Tokens the marketer typed that don't match a real field (e.g. a typo like {{frstName}}).
  // These send as literal text, so the warning has to be visible, not a hover-only title.
  const unknownTokens = Array.from(
    new Set(spans.filter((s) => s.token && !s.known).map((s) => s.token)),
  );

  function insertToken(token: string) {
    const el = textareaRef.current;
    const snippet = `{{${token}}}`;
    if (!el) {
      setBody((b) => b + snippet);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + snippet + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + snippet.length;
      el.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="artifact-in overflow-hidden rounded-2xl border border-border bg-card/40 shadow-elevated">
      {/* Header band */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-gradient-to-br from-msg/10 to-transparent px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-msg">
            <MessageSquareText className="h-3.5 w-3.5" />
            Message copy
          </div>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-foreground">
            Draft for review
          </h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
          <ChannelIcon className="h-3.5 w-3.5" />
          {meta.label}
        </span>
      </div>

      <div className="space-y-4 px-5 py-4">
        {/* Editable body */}
        <div>
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={isShortForm ? 3 : 5}
            aria-label={`${meta.label} message body`}
            className="w-full resize-y rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm leading-relaxed text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <div className="flex flex-wrap gap-1">
              {MESSAGE_TOKENS.map((t) => (
                <button
                  key={t}
                  onClick={() => insertToken(t)}
                  className="rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-95"
                >
                  {`{{${t}}}`}
                </button>
              ))}
            </div>
            <span
              className={cn(
                "shrink-0 pl-2 text-[11px] tabular-nums",
                isShortForm && body.length > 160
                  ? "text-warning"
                  : "text-muted-foreground",
              )}
            >
              {body.length}
              {isShortForm ? " / 160" : " chars"}
            </span>
          </div>
        </div>

        {/* Live token preview */}
        <div className="rounded-xl border border-border/60 bg-background/30 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Eye className="h-3.5 w-3.5" />
            Preview · {previewCustomer.firstName} {previewCustomer.lastName}
            {!sampleCustomer && (
              <span className="font-normal normal-case text-muted-foreground">
                (example)
              </span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {spans.map((s, i) =>
              s.token ? (
                <span
                  key={i}
                  className={cn(
                    "rounded px-0.5",
                    s.known
                      ? "bg-msg/15 text-msg"
                      : "bg-destructive/15 text-destructive-foreground",
                  )}
                  title={s.known ? `{{${s.token}}}` : `unknown token {{${s.token}}}`}
                >
                  {s.known ? s.text || "—" : s.text}
                </span>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </p>
          {unknownTokens.length > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                {unknownTokens.map((t) => `{{${t}}}`).join(", ")} won&apos;t be
                filled in; unknown fields send exactly as written. Pick one from
                the buttons above.
              </span>
            </p>
          )}
        </div>

        {result.rationale && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-msg" />
            {result.rationale}
          </p>
        )}
      </div>
    </div>
  );
}
