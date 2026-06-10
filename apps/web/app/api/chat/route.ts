import { type ModelMessage, stepCountIs, streamText } from "ai";

import { buildTools } from "@/lib/ai/tools";
import { geminiModel, hasGeminiKey } from "@/lib/ai/provider";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { crm } from "@/lib/crm-client";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Hobby ceiling — keep turns to <=2 tool calls.

/** Allow up to 2 tool-call rounds + a final text step before stopping. */
const MAX_STEPS = 3;
/** SDK retries (exponential backoff) before a 429 is surfaced as a typed error. */
const MAX_MODEL_RETRIES = 3;

interface IncomingMessage {
  role: "user" | "assistant" | "system";
  // Either a plain string, or AI SDK UIMessage parts.
  content?: unknown;
  parts?: Array<{ type: string; text?: string }>;
}

/** Flatten a UIMessage (or simple {role,content}) to plain text. */
function messageText(m: IncomingMessage): string {
  if (Array.isArray(m.parts)) {
    return m.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  return typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
}

export async function POST(req: Request): Promise<Response> {
  if (!hasGeminiKey()) {
    return Response.json(
      { error: "config", message: "GEMINI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: { messages?: IncomingMessage[]; threadId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad_request", message: "Invalid JSON body." }, { status: 400 });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  if (incoming.length === 0) {
    return Response.json({ error: "bad_request", message: "messages[] is required." }, { status: 400 });
  }

  // Ensure a thread, then persist the latest user turn. The AI never writes — the route does,
  // via the CRM. Persistence failures must not block the conversation, so they're swallowed.
  let threadId = body.threadId;
  if (!threadId) {
    try {
      threadId = (await crm.createThread()).id;
    } catch {
      threadId = undefined;
    }
  }
  const lastUser = [...incoming].reverse().find((m) => m.role === "user");
  if (threadId && lastUser) {
    await crm
      .appendMessages(threadId, [{ role: "USER", content: messageText(lastUser) }])
      .catch(() => undefined);
  }

  const modelMessages: ModelMessage[] = incoming
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: messageText(m) }));

  const result = streamText({
    model: geminiModel(),
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    tools: buildTools(),
    stopWhen: stepCountIs(MAX_STEPS),
    maxRetries: MAX_MODEL_RETRIES,
    // A transient model error (e.g. a 429 surviving retries) is surfaced into the stream as a
    // typed error part rather than crashing the request.
    onError: ({ error }) => {
      console.error("[/api/chat] stream error:", error);
    },
    onFinish: async ({ text }) => {
      if (threadId && text) {
        await crm
          .appendMessages(threadId, [{ role: "ASSISTANT", content: text }])
          .catch(() => undefined);
      }
    },
  });

  return result.toUIMessageStreamResponse({
    headers: threadId ? { "x-thread-id": threadId } : undefined,
  });
}
