"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
import {
  ArrowUp,
  BarChart3,
  Loader2,
  RotateCcw,
  Sparkles,
  Square,
  Wand2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AI_TOOL_NAMES } from "@xeno/shared";
import {
  asFailure,
  isOk,
  type DraftMessageSuccess,
  type NarrateResultsSuccess,
  type SegmentRuleSuccess,
} from "@/lib/ai/tool-results";
import {
  SegmentRuleCard,
  type ActiveSegment,
} from "@/components/console/segment-rule-card";
import {
  MessageDraftCard,
  type ActiveMessage,
} from "@/components/console/message-draft-card";
import { NarrateResultsCard } from "@/components/console/narrate-results-card";
import { LaunchPanel } from "@/components/console/launch-panel";
import { ToolFailureCard } from "@/components/console/tool-failure-card";

const EXAMPLE_PROMPTS = [
  "Win back people who bought sneakers over 60 days ago",
  "Reach loyal Gold-tier customers in Mumbai with a WhatsApp thank-you",
  "Target big spenders (₹50k+) who haven’t ordered in 90 days",
];

export function Console() {
  // Thread continuity: capture the server-issued thread id from the response header and
  // replay it on every subsequent turn so the conversation persists to one ChatThread.
  const threadIdRef = useRef<string | undefined>(undefined);
  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat",
        fetch: async (url, init) => {
          const res = await fetch(url, init);
          const tid = res.headers.get("x-thread-id");
          if (tid) threadIdRef.current = tid;
          return res;
        },
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: { ...body, messages, threadId: threadIdRef.current },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error, regenerate, stop } = useChat({
    transport,
  });

  const [input, setInput] = useState("");
  const [activeSegment, setActiveSegment] = useState<ActiveSegment | null>(null);
  const [activeMessage, setActiveMessage] = useState<ActiveMessage | null>(null);

  const handleSegmentActive = useCallback(
    (s: ActiveSegment) => setActiveSegment(s),
    [],
  );
  const handleMessageActive = useCallback(
    (m: ActiveMessage) => setActiveMessage(m),
    [],
  );

  const busy = status === "submitted" || status === "streaming";

  // Auto-scroll to the latest content as it streams.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, activeSegment, activeMessage]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    void sendMessage({ text: trimmed });
  }

  const rateLimited = /rate.?limit|429|busy/i.test(error?.message ?? "");
  const showLaunch = Boolean(activeSegment && activeMessage);

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-5 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-violet-500 text-white">
            <Wand2 className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight text-foreground">
              Looms · Campaign Console
            </p>
            <p className="text-[11px] text-muted-foreground">
              State your intent — review, edit, launch.
            </p>
          </div>
        </div>
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Campaigns
        </Link>
      </header>

      {/* ── Conversation ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {messages.length === 0 ? (
            <EmptyState onPick={submit} />
          ) : (
            <div className="space-y-6">
              {messages.map((m) => (
                <MessageBlock
                  key={m.id}
                  message={m}
                  onSegmentActive={handleSegmentActive}
                  onMessageActive={handleMessageActive}
                  sampleCustomer={activeSegment?.sample[0]}
                  onRetry={() => void regenerate()}
                />
              ))}

              {status === "submitted" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking…
                </div>
              )}

              {error && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-5 py-4">
                  <p className="text-sm font-medium text-foreground">
                    {rateLimited
                      ? "The model is busy right now"
                      : "The assistant hit a snag"}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {rateLimited
                      ? "Gemini is rate-limited. Give it a moment, then retry."
                      : "Something interrupted that turn."}
                  </p>
                  <button
                    onClick={() => void regenerate()}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/50 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </button>
                </div>
              )}

              {showLaunch && activeSegment && activeMessage && (
                <LaunchPanel
                  key={`${activeSegment.toolCallId}:${activeMessage.toolCallId}`}
                  segment={activeSegment}
                  message={activeMessage}
                />
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Composer ── */}
      <div className="shrink-0 border-t border-border/60 bg-background/80 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-card/50 px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              rows={1}
              placeholder="Describe the audience you want to reach…"
              className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {busy ? (
              <button
                onClick={() => void stop()}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary text-secondary-foreground transition-colors hover:bg-accent"
                title="Stop"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={() => submit(input)}
                disabled={!input.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                title="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1.5 px-1 text-center text-[11px] text-muted-foreground">
            The assistant proposes editable artifacts. Nothing sends until you
            confirm a launch.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center px-2 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-violet-500 text-white">
        <Sparkles className="h-6 w-6" />
      </div>
      <h1 className="mt-5 text-xl font-semibold tracking-tight text-foreground">
        What audience do you want to reach?
      </h1>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        Describe it in plain English. I’ll turn it into an editable segment, a
        message draft, and a launch you control.
      </p>
      <div className="mt-6 grid w-full max-w-xl gap-2">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="group flex items-center gap-2 rounded-xl border border-border bg-card/40 px-4 py-3 text-left text-sm text-foreground/90 transition-colors hover:border-sky-500/40 hover:bg-accent"
          >
            <Wand2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <span>{p}</span>
            <ArrowUp className="ml-auto h-3.5 w-3.5 rotate-45 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── One message (user bubble or assistant text + tool cards) ───────

function MessageBlock({
  message,
  onSegmentActive,
  onMessageActive,
  sampleCustomer,
  onRetry,
}: {
  message: UIMessage;
  onSegmentActive: (s: ActiveSegment) => void;
  onMessageActive: (m: ActiveMessage) => void;
  sampleCustomer: ActiveSegment["sample"][number] | undefined;
  onRetry: () => void;
}) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          if (!part.text.trim()) return null;
          return (
            <p
              key={i}
              className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90"
            >
              {part.text}
            </p>
          );
        }

        if (isToolUIPart(part)) {
          const name = getToolName(part);
          const key = part.toolCallId || `${name}-${i}`;

          // Streaming / awaiting the tool result.
          if (part.state === "input-streaming" || part.state === "input-available") {
            return <ToolPending key={key} name={name} />;
          }
          if (part.state === "output-error") {
            return (
              <ToolFailureCard
                key={key}
                failure={{
                  ok: false,
                  error: "failed",
                  message: part.errorText ?? "The tool failed.",
                }}
              />
            );
          }
          if (part.state !== "output-available") return null;

          const output = part.output;
          const failure = asFailure(output);

          if (name === AI_TOOL_NAMES.generateSegmentRule) {
            if (failure)
              return (
                <ToolFailureCard key={key} failure={failure} onRetry={onRetry} />
              );
            if (isOk<SegmentRuleSuccess>(output)) {
              return (
                <SegmentRuleCard
                  key={key}
                  toolCallId={part.toolCallId}
                  result={output}
                  onActive={onSegmentActive}
                />
              );
            }
          }

          if (name === AI_TOOL_NAMES.draftMessage) {
            if (failure)
              return (
                <ToolFailureCard key={key} failure={failure} onRetry={onRetry} />
              );
            if (isOk<DraftMessageSuccess>(output)) {
              return (
                <MessageDraftCard
                  key={key}
                  toolCallId={part.toolCallId}
                  result={output}
                  sampleCustomer={sampleCustomer}
                  onActive={onMessageActive}
                />
              );
            }
          }

          if (name === AI_TOOL_NAMES.narrateResults) {
            if (failure)
              return (
                <ToolFailureCard key={key} failure={failure} onRetry={onRetry} />
              );
            if (isOk<NarrateResultsSuccess>(output)) {
              return <NarrateResultsCard key={key} result={output} />;
            }
          }
        }

        return null;
      })}
    </div>
  );
}

function ToolPending({ name }: { name: string }) {
  const label =
    name === AI_TOOL_NAMES.generateSegmentRule
      ? "Building the audience segment…"
      : name === AI_TOOL_NAMES.draftMessage
        ? "Drafting the message…"
        : name === AI_TOOL_NAMES.narrateResults
          ? "Reading the campaign stats…"
          : "Working…";
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card/30 px-4 py-3 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
      {label}
    </div>
  );
}
