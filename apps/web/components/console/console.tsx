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
  Plus,
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

/** sessionStorage key for the thread snapshot — a refresh restores the conversation. */
const STORAGE_KEY = "xeno-console-thread";

/**
 * Client-side stall watchdog: if a turn is in flight but the stream has made no progress for
 * this long, declare it stalled and surface a retry banner. The server already aborts itself
 * at 50s, so this only catches transport-level hangs (e.g. a connection that never errors);
 * it must sit ABOVE the server window so it never races a slow-but-healthy turn.
 */
const STALL_WATCHDOG_MS = 65_000;

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

  const { messages, sendMessage, setMessages, status, error, clearError, regenerate, stop } =
    useChat({ transport });

  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [activeSegment, setActiveSegment] = useState<ActiveSegment | null>(null);
  const [activeMessage, setActiveMessage] = useState<ActiveMessage | null>(null);
  // A turn that hung or ended with nothing — shows a retry banner distinct from `error`.
  const [stalled, setStalled] = useState(false);

  const handleSegmentActive = useCallback(
    (s: ActiveSegment) => setActiveSegment(s),
    [],
  );
  const handleMessageActive = useCallback(
    (m: ActiveMessage) => setActiveMessage(m),
    [],
  );

  const busy = status === "submitted" || status === "streaming";

  // Auto-grow the composer with its content so multi-line drafts are visible as they're typed,
  // capped by the textarea's max-h (it scrolls past that). Runs on every input change, including
  // the reset to "" after send. Pure height set, no transition — nothing for reduced-motion to do.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // ── Thread persistence ──
  // Restore the snapshot once after mount (effect, not render, to avoid hydration mismatch).
  // The tool cards re-fire onActive on mount, so restored segment/message cards also restore
  // the launch panel.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { threadId?: string; messages?: UIMessage[] };
      if (saved.threadId) threadIdRef.current = saved.threadId;
      if (Array.isArray(saved.messages) && saved.messages.length > 0) {
        setMessages(saved.messages);
      }
    } catch {
      sessionStorage.removeItem(STORAGE_KEY); // corrupted snapshot — start fresh
    }
  }, [setMessages]);

  // Snapshot whenever a turn settles (not per streamed token).
  useEffect(() => {
    if (busy || messages.length === 0) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ threadId: threadIdRef.current, messages }),
      );
    } catch {
      // Storage full/unavailable — persistence is best-effort.
    }
  }, [busy, messages]);

  // ── Stall detection ──
  // 1. Watchdog: no stream progress for STALL_WATCHDOG_MS while busy → stop + banner.
  const lastProgressRef = useRef(Date.now());
  useEffect(() => {
    lastProgressRef.current = Date.now(); // any messages change while busy counts as progress
  }, [messages]);
  useEffect(() => {
    if (!busy) return;
    lastProgressRef.current = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - lastProgressRef.current >= STALL_WATCHDOG_MS) {
        void stop();
        setStalled(true);
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, [busy, stop]);

  // 2. Empty finish: the server aborts a stalled model turn at ~50s; the stream then ends
  // cleanly but without content. Detect a busy→ready transition that produced nothing and
  // surface the same retry banner instead of silently going idle.
  const userStoppedRef = useRef(false);
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if ((prev !== "submitted" && prev !== "streaming") || status !== "ready") return;
    if (userStoppedRef.current) {
      userStoppedRef.current = false; // the user hit Stop — idle is what they asked for
      return;
    }
    const last = messages[messages.length - 1];
    const producedContent =
      last?.role === "assistant" &&
      last.parts.some(
        (p) => (p.type === "text" && p.text.trim().length > 0) || isToolUIPart(p),
      );
    if (!producedContent) setStalled(true);
  }, [status, messages]);

  // Auto-scroll to the latest content as it streams. Honor prefers-reduced-motion: jump
  // instantly rather than smooth-scrolling on every streamed token.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottomRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, activeSegment, activeMessage]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    setStalled(false);
    void sendMessage({ text: trimmed });
  }

  function retryTurn() {
    setStalled(false);
    void regenerate();
  }

  function resetThread() {
    sessionStorage.removeItem(STORAGE_KEY);
    threadIdRef.current = undefined;
    setMessages([]);
    setActiveSegment(null);
    setActiveMessage(null);
    setStalled(false);
    setInput("");
    clearError();
  }

  const rateLimited = /rate.?limit|429|busy/i.test(error?.message ?? "");
  const showLaunch = Boolean(activeSegment && activeMessage);

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 bg-background/70 px-5 py-3 backdrop-blur-md">
        <Link
          href="/"
          title="Back to home"
          className="flex items-center gap-2.5 rounded-lg transition-opacity hover:opacity-80"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/15 text-brand ring-1 ring-inset ring-brand/25">
            <Wand2 className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold tracking-tight text-foreground">
              Looms · Campaign Console
            </h1>
            <p className="text-[11px] text-muted-foreground">
              State your intent: review, edit, launch.
            </p>
          </div>
        </Link>
        <nav className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={resetThread}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.98] disabled:opacity-40"
              title="Start a fresh conversation"
            >
              <Plus className="h-3.5 w-3.5" />
              New chat
            </button>
          )}
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.98]"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Campaigns
          </Link>
        </nav>
      </header>

      {/* ── Conversation ── */}
      <main className="flex-1 overflow-y-auto">
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
                  onRetry={retryTurn}
                />
              ))}

              {status === "submitted" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking…
                </div>
              )}

              {error && (
                <div className="rounded-2xl border border-warning/30 bg-warning/5 px-5 py-4">
                  <p className="text-sm font-medium text-foreground">
                    {rateLimited
                      ? "The assistant is busy right now"
                      : "The assistant hit a snag"}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {rateLimited
                      ? "Too many requests came in at once. Wait a few seconds, then retry."
                      : "Something interrupted that turn."}
                  </p>
                  <button
                    onClick={retryTurn}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/50 px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent active:scale-[0.98]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </button>
                </div>
              )}

              {stalled && !error && !busy && (
                <div className="rounded-2xl border border-warning/30 bg-warning/5 px-5 py-4">
                  <p className="text-sm font-medium text-foreground">
                    That turn went quiet
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    The assistant didn’t respond in time. It may be handling too
                    many requests; give it a few seconds, then retry.
                  </p>
                  <button
                    onClick={retryTurn}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/50 px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent active:scale-[0.98]"
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
      </main>

      {/* ── Composer ── */}
      <div className="shrink-0 border-t border-border/60 bg-background/80 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-card/50 px-3 py-2 shadow-elevated transition duration-200 focus-within:border-brand/40 focus-within:ring-2 focus-within:ring-brand/30">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              rows={1}
              aria-label="Describe the audience you want to reach"
              placeholder="Describe the audience you want to reach…"
              className="max-h-40 min-h-[24px] flex-1 resize-none overflow-y-auto bg-transparent py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {busy ? (
              <button
                onClick={() => {
                  userStoppedRef.current = true;
                  void stop();
                }}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-secondary-foreground transition hover:bg-accent active:scale-95"
                title="Stop generating"
                aria-label="Stop generating"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : (
              <button
                onClick={() => submit(input)}
                disabled={!input.trim()}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground transition duration-200 hover:scale-105 hover:bg-primary/90 hover:shadow-elevated active:scale-95 disabled:scale-100 disabled:opacity-40 disabled:shadow-none"
                title="Send message"
                aria-label="Send message"
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
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
    <div className="flex min-h-[calc(100dvh-13rem)] flex-col items-center justify-center px-2 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15 text-brand ring-1 ring-inset ring-brand/25">
        <Sparkles className="h-6 w-6" />
      </div>
      <h2 className="mt-5 text-2xl font-semibold tracking-tight text-balance text-foreground">
        What audience do you want to reach?
      </h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">
        Describe it in plain English. I’ll turn it into an editable segment, a
        message draft, and a launch you control.
      </p>
      <div className="mt-7 grid w-full max-w-xl gap-2">
        <p className="px-1 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Try one of these
        </p>
        {EXAMPLE_PROMPTS.map((p, i) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            style={{ animationDelay: `${120 + i * 70}ms` }}
            className="msg-in group flex items-center gap-2.5 rounded-xl border border-border bg-card/40 px-4 py-3 text-left text-sm text-foreground/90 transition duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:bg-accent hover:shadow-elevated active:scale-[0.99]"
          >
            <Wand2 className="h-3.5 w-3.5 shrink-0 text-brand transition-transform duration-200 group-hover:rotate-[-8deg] group-hover:scale-110" />
            <span>{p}</span>
            <ArrowUp className="ml-auto h-3.5 w-3.5 shrink-0 -translate-x-1 rotate-45 text-brand opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
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
      <div className="msg-in flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-elevated">
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
              className="msg-in whitespace-pre-wrap text-sm leading-relaxed text-foreground/90"
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
      <Loader2 className="h-4 w-4 animate-spin text-brand" />
      {label}
    </div>
  );
}
