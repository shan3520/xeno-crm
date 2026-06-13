import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, type LanguageModel } from "ai";

import { isRateLimited } from "@/lib/ai/errors";
import { GEMINI_MODEL_ID, geminiModel } from "@/lib/ai/provider";

/**
 * Provider fallback chain — multiple free LLM providers tried IN ORDER until one serves the
 * turn. Resolution is config-driven:
 *
 *   AI_PROVIDER_ORDER  comma-separated provider ids tried in order, e.g. "groq,gemini".
 *                      Defaults to "groq,gemini" — Groq primary, Gemini as the fallback.
 *   (per provider)     each provider reads its own key + model id from env (see REGISTRY);
 *                      a provider whose key is missing is SKIPPED, never an error.
 *
 * HARD REQUIREMENT: every model in the chain must support tool calling (function calling) —
 * the console's generate_segment_rule / draft_message / narrate_results tools depend on it.
 * Do not register a provider/model here that can't do function calling.
 *
 * Fallback fires ONLY on transient/availability errors (429/RESOURCE_EXHAUSTED, 5xx, auth,
 * network) — see isProviderUnavailable. A schema-validation failure of tool OUTPUT happens
 * above this layer (zod in tools.ts) and never triggers a provider switch.
 *
 * ── Adding a provider ─────────────────────────────────────────────────────────────────
 * 1. `pnpm --filter web add @ai-sdk/<provider>` (must be an AI SDK v3-spec provider).
 * 2. Add one REGISTRY entry below: id, isConfigured() (its env key), modelId() (its env
 *    model id with a tool-calling-capable default), tag() for AiTaskLog, model().
 * 3. Add the env vars to .env.example, then include the id in AI_PROVIDER_ORDER.
 * Nothing else changes — the chain, the route, and the tools pick it up automatically.
 *
 * Intentionally NOT wired (documented decisions, not oversights):
 *   - OpenRouter: requires a $10 top-up to unlock free-model quota — not actually free.
 *   - NVIDIA NIM: deferred; wire as above via an OpenAI-compatible provider if needed.
 */

/** The spec-level (non-string) model type accepted by streamText/generateText. */
type SpecModel = Extract<Exclude<LanguageModel, string>, { specificationVersion: "v3" }>;

/** One provider definition: how to detect config, build a model, and label it in logs. */
interface ProviderSpec {
  id: string;
  /** True when the env carries everything this provider needs (key present). */
  isConfigured: () => boolean;
  /** Model id, env-driven with a tool-calling-capable default. */
  modelId: () => string;
  /**
   * Tag recorded in AiTaskLog's `model` field. Gemini keeps today's bare model id so
   * existing rows/queries stay comparable; every other provider uses "provider:model".
   */
  tag: () => string;
  /** Build the AI SDK model. MUST support tool calling. */
  model: () => SpecModel;
}

/** A chain entry with its env-derived fields resolved. */
export interface ResolvedProvider {
  id: string;
  tag: string;
  model: SpecModel;
}

// llama-3.3-70b-versatile supports function calling — required (see header).
const GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile";
const groqModelId = (): string => process.env.GROQ_MODEL ?? GROQ_DEFAULT_MODEL;

const NVIDIA_DEFAULT_MODEL = "meta/llama-3.3-70b-instruct";
const nvidiaModelId = (): string => process.env.NVIDIA_MODEL ?? NVIDIA_DEFAULT_MODEL;

const REGISTRY: Record<string, ProviderSpec> = {
  gemini: {
    id: "gemini",
    isConfigured: () => Boolean(process.env.GEMINI_API_KEY),
    modelId: () => GEMINI_MODEL_ID,
    tag: () => GEMINI_MODEL_ID,
    // Reuse provider.ts's construction so the gemini path is literally today's model.
    model: () => geminiModel() as SpecModel,
  },
  groq: {
    id: "groq",
    isConfigured: () => Boolean(process.env.GROQ_API_KEY),
    modelId: groqModelId,
    tag: () => `groq:${groqModelId()}`,
    model: () =>
      createGroq({ apiKey: process.env.GROQ_API_KEY ?? "" })(groqModelId()) as SpecModel,
  },
  nvidia: {
    id: "nvidia",
    isConfigured: () => Boolean(process.env.NVIDIA_API_KEY),
    modelId: nvidiaModelId,
    tag: () => `nvidia:${nvidiaModelId()}`,
    model: () => {
      const nvidiaProvider = createOpenAI({
        baseURL: "https://integrate.api.nvidia.com/v1",
        apiKey: process.env.NVIDIA_API_KEY ?? "",
      });
      // .chat() forces the /v1/chat/completions endpoint. The default provider call now targets
      // OpenAI's /v1/responses API, which NVIDIA NIM does NOT implement — it 404s ("404 page not
      // found"), and a 404 isn't a fallthrough error, so the whole turn dies. NVIDIA only speaks
      // chat-completions, so pin it explicitly.
      return nvidiaProvider.chat(nvidiaModelId()) as SpecModel;
    },
  },
};

/**
 * Resolve the ordered provider chain from AI_PROVIDER_ORDER. Unknown ids are skipped with a
 * warning; unconfigured providers (missing key) are skipped silently by design. An unset or
 * blank AI_PROVIDER_ORDER means "groq,gemini".
 */
export function providerChain(): ResolvedProvider[] {
  const raw = process.env.AI_PROVIDER_ORDER?.trim() || "groq,gemini";
  const chain: ResolvedProvider[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if (!id) continue;
    const spec = REGISTRY[id];
    if (!spec) {
      console.warn(`[ai/providers] unknown provider "${id}" in AI_PROVIDER_ORDER — skipped`);
      continue;
    }
    if (!spec.isConfigured()) continue; // no key → silently not in the chain
    chain.push({ id: spec.id, tag: spec.tag(), model: spec.model() });
  }
  return chain;
}

/**
 * Transient/availability errors that justify falling through to the next provider:
 * rate limits (429/RESOURCE_EXHAUSTED/quota), server-side unavailability (5xx/529),
 * auth misconfiguration (401/403 — a broken key shouldn't kill the turn when another
 * provider works), and network-level failures. Anything else (e.g. a 400 for an
 * unsupported request shape) is a REAL error and is rethrown unchanged — falling
 * through would only mask it.
 */
export function isProviderUnavailable(err: unknown): boolean {
  if (isRateLimited(err)) return true;
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ?? 0;
    return err.isRetryable || status === 401 || status === 403 || status >= 500;
  }
  // Undici/fetch network failures ("fetch failed", ECONNREFUSED, DNS, …).
  return err instanceof TypeError;
}

/**
 * Per-provider response budget. A SLOW provider (not erroring, just not responding — e.g.
 * NVIDIA NIM's free tier under latency) would otherwise hold the whole turn until the route's
 * overall STREAM_TIMEOUT and then die with no fallback. This budget bounds how long any one
 * provider may take before we move on; it must be comfortably smaller than the route's overall
 * timeout (50s) so at least two providers can be tried within a single turn.
 */
const providerTimeoutMs = (): number => Number(process.env.AI_PROVIDER_TIMEOUT_MS) || 22_000;

/** A provider was too SLOW (vs. erroring). Treated like an availability error: fall through. */
export class ProviderTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderTimeoutError";
  }
}

/** Reject if `promise` doesn't settle within `ms`, with a ProviderTimeoutError. */
async function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderTimeoutError(`${label} (>${ms}ms)`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * For streaming: require the FIRST chunk within `ms`, then pass the rest through untouched.
 * We can't put a flat timeout on a stream (it would cut off a healthy long response), and a
 * deadline buried inside the returned stream couldn't trigger fallback (the call already
 * returned). So we await the first read here — inside the fallback's try — and only after it
 * arrives do we hand back a stream reconstructed from {first chunk, …remainder}. A first-chunk
 * timeout throws ProviderTimeoutError so withFallback moves to the next provider.
 */
async function guardStreamStart<C, R extends { stream: ReadableStream<C> }>(
  resultPromise: PromiseLike<R>,
  ms: number,
  label: string,
): Promise<R> {
  const result = await withTimeout(resultPromise, ms, `${label} connect`);
  const reader = result.stream.getReader();
  let first: ReadableStreamReadResult<C>;
  try {
    first = await withTimeout(reader.read(), ms, `${label} first chunk`);
  } catch (err) {
    reader.cancel().catch(() => undefined); // abort the slow upstream before falling through
    throw err;
  }
  const stream = new ReadableStream<C>({
    start(controller) {
      if (first.done) controller.close();
      else controller.enqueue(first.value);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => undefined);
    },
  });
  return { ...result, stream };
}

/**
 * Wrap a provider chain as ONE AI SDK model that tries each entry in order. Works for both
 * doGenerate (generateText/generateObject in the tools) and doStream (the chat route): a
 * provider that rejects the CALL with an availability error (the way 429s surface — before
 * any stream output) OR is too SLOW to start (ProviderTimeoutError, see guardStreamStart /
 * providerTimeoutMs) falls through to the next; the last error is thrown if all fail.
 * An error arriving mid-stream AFTER the first chunk cannot be retried and surfaces as today.
 *
 * `onServe` fires with the entry that actually served the call — use it to record the
 * provider+model in AiTaskLog and to log fallbacks.
 *
 * A single-entry chain returns the underlying model UNWRAPPED, so the default
 * (gemini-only) configuration runs exactly today's code path.
 */
export function withFallback(
  chain: ResolvedProvider[],
  onServe?: (served: ResolvedProvider) => void,
): SpecModel {
  if (chain.length === 0) {
    throw new Error("withFallback: provider chain is empty — no configured provider");
  }
  const primary = chain[0]!;
  if (chain.length === 1) return primary.model;

  async function attempt<T>(call: (m: SpecModel) => PromiseLike<T>): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i]!;
      try {
        const result = await call(entry.model);
        if (i > 0) console.warn(`[ai/fallback] turn served by fallback provider "${entry.id}"`);
        onServe?.(entry);
        return result;
      } catch (err) {
        lastError = err;
        // Fall through on availability errors (429/5xx/auth/network) AND on a too-slow provider
        // (ProviderTimeoutError) — both mean "this provider can't serve the turn, try the next".
        const recoverable = isProviderUnavailable(err) || err instanceof ProviderTimeoutError;
        if (i === chain.length - 1 || !recoverable) throw err;
        console.warn(
          `[ai/fallback] provider "${entry.id}" unavailable (${
            err instanceof Error ? err.message : String(err)
          }) — trying "${chain[i + 1]!.id}"`,
        );
      }
    }
    throw lastError; // unreachable, but keeps TS + future edits honest
  }

  return {
    specificationVersion: "v3",
    provider: "fallback",
    modelId: chain.map((e) => e.tag).join(","),
    // Advertise the PRIMARY's URL support; prompts here are text-only so this only
    // matters if a future prompt embeds URLs, in which case the SDK falls back to
    // downloading them — safe for every provider.
    supportedUrls: primary.model.supportedUrls,
    doGenerate: (options) =>
      attempt((m) => withTimeout(m.doGenerate(options), providerTimeoutMs(), "doGenerate")),
    doStream: (options) =>
      attempt((m) => guardStreamStart(m.doStream(options), providerTimeoutMs(), "doStream")),
  };
}

/**
 * One-time boot health log (runs at cold start on module import). Reports which provider keys
 * are present and the configured order — ids only, never key values. This is the startup half
 * of cascade-detection: if e.g. NVIDIA_API_KEY isn't set, "nvidia" won't appear here and can't
 * be in any request's chain, no matter what AI_PROVIDER_ORDER lists.
 */
const bootConfigured = Object.values(REGISTRY)
  .filter((spec) => spec.isConfigured())
  .map((spec) => spec.id);
console.log(
  `[ai/providers] boot — keys present: ${bootConfigured.join(",") || "(none)"} | order: ${
    process.env.AI_PROVIDER_ORDER?.trim() || "groq,gemini (default)"
  }`,
);
