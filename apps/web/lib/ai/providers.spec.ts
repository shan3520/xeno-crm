/// <reference types="vitest/globals" />
import { APICallError } from "ai";

import {
  isProviderUnavailable,
  providerChain,
  withFallback,
  type ResolvedProvider,
} from "@/lib/ai/providers";

const apiCallError = (status: number, message: string, isRetryable = false): APICallError =>
  new APICallError({
    message,
    url: "https://example.invalid",
    requestBodyValues: {},
    statusCode: status,
    isRetryable,
  });

/** Build a fake spec model whose doGenerate/doStream resolve or reject as scripted. */
function fakeModel(behavior: () => Promise<unknown>): ResolvedProvider["model"] {
  return {
    specificationVersion: "v3",
    provider: "fake",
    modelId: "fake-model",
    supportedUrls: {},
    doGenerate: behavior,
    doStream: behavior,
  } as unknown as ResolvedProvider["model"];
}

const entry = (id: string, model: ResolvedProvider["model"]): ResolvedProvider => ({
  id,
  tag: `${id}:fake-model`,
  model,
});

/** Fake model whose doStream resolves to the given {stream} (doGenerate unused here). */
function streamModel(
  behavior: () => Promise<{ stream: ReadableStream<unknown> }>,
): ResolvedProvider["model"] {
  return {
    specificationVersion: "v3",
    provider: "fake",
    modelId: "fake-model",
    supportedUrls: {},
    doGenerate: behavior,
    doStream: behavior,
  } as unknown as ResolvedProvider["model"];
}

/** A stream that enqueues the given chunks then closes. */
const streamOf = (chunks: unknown[]): ReadableStream<unknown> =>
  new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });

/** A stream that never produces a chunk (simulates a provider too slow to start). */
const neverStream = (): ReadableStream<unknown> => new ReadableStream({});

/** Drain a stream to an array of its chunks. */
async function drain<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const out: T[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe("providerChain (env-driven resolution)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to groq,gemini when AI_PROVIDER_ORDER is unset or blank", () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GROQ_API_KEY", "k");
    vi.stubEnv("AI_PROVIDER_ORDER", "");
    expect(providerChain().map((p) => p.id)).toEqual(["groq", "gemini"]);
  });

  it("includes providers in the configured order", () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GROQ_API_KEY", "k");
    vi.stubEnv("AI_PROVIDER_ORDER", "gemini,groq");
    expect(providerChain().map((p) => p.id)).toEqual(["gemini", "groq"]);
  });

  it("silently skips a provider whose key is missing — never an error", () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("AI_PROVIDER_ORDER", "gemini,groq");
    expect(providerChain().map((p) => p.id)).toEqual(["gemini"]);
  });

  it("skips unknown provider ids without breaking the rest of the chain", () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("AI_PROVIDER_ORDER", "openrouter,gemini");
    expect(providerChain().map((p) => p.id)).toEqual(["gemini"]);
  });

  it("tags gemini with the bare model id (log-compatible) and groq as provider:model", () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GROQ_API_KEY", "k");
    vi.stubEnv("GROQ_MODEL", "llama-3.3-70b-versatile");
    vi.stubEnv("AI_PROVIDER_ORDER", "gemini,groq");
    const [gemini, groq] = providerChain();
    expect(gemini!.tag).not.toContain(":");
    expect(groq!.tag).toBe("groq:llama-3.3-70b-versatile");
  });
});

describe("withFallback (ordered provider attempts)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the bare model unwrapped for a single-entry chain (today's path)", () => {
    const model = fakeModel(() => Promise.resolve("ok"));
    expect(withFallback([entry("gemini", model)])).toBe(model);
  });

  it("falls through to the next provider on a rate-limit and reports who served", async () => {
    const limited = fakeModel(() => Promise.reject(apiCallError(429, "Too Many Requests", true)));
    const healthy = fakeModel(() => Promise.resolve("served-by-groq"));
    let served = "";
    const model = withFallback(
      [entry("gemini", limited), entry("groq", healthy)],
      (p) => (served = p.id),
    );
    await expect(
      model.doGenerate({} as Parameters<typeof model.doGenerate>[0]),
    ).resolves.toBe("served-by-groq");
    expect(served).toBe("groq");
  });

  it("does NOT fall through on a non-availability error (no pointless provider switch)", async () => {
    const bad = fakeModel(() => Promise.reject(apiCallError(400, "invalid request shape")));
    const healthy = fakeModel(() => Promise.resolve("never reached"));
    const model = withFallback([entry("gemini", bad), entry("groq", healthy)]);
    await expect(
      model.doGenerate({} as Parameters<typeof model.doGenerate>[0]),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws the LAST provider's error when every provider is unavailable", async () => {
    const a = fakeModel(() => Promise.reject(apiCallError(429, "gemini quota", true)));
    const b = fakeModel(() => Promise.reject(apiCallError(503, "groq down", true)));
    const model = withFallback([entry("gemini", a), entry("groq", b)]);
    await expect(
      model.doGenerate({} as Parameters<typeof model.doGenerate>[0]),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("falls through when a provider is too SLOW to respond (doGenerate timeout)", async () => {
    vi.stubEnv("AI_PROVIDER_TIMEOUT_MS", "30");
    const slow = fakeModel(() => new Promise(() => {})); // never resolves
    const healthy = fakeModel(() => Promise.resolve("served-by-groq"));
    let served = "";
    const model = withFallback(
      [entry("nvidia", slow), entry("groq", healthy)],
      (p) => (served = p.id),
    );
    await expect(
      model.doGenerate({} as Parameters<typeof model.doGenerate>[0]),
    ).resolves.toBe("served-by-groq");
    expect(served).toBe("groq");
  });

  it("falls through when a stream never produces a first chunk (doStream timeout)", async () => {
    vi.stubEnv("AI_PROVIDER_TIMEOUT_MS", "30");
    const slow = streamModel(() => Promise.resolve({ stream: neverStream() }));
    const healthy = streamModel(() => Promise.resolve({ stream: streamOf(["chunk-a"]) }));
    let served = "";
    const model = withFallback(
      [entry("nvidia", slow), entry("groq", healthy)],
      (p) => (served = p.id),
    );
    const result = (await model.doStream({} as Parameters<typeof model.doStream>[0])) as {
      stream: ReadableStream<unknown>;
    };
    expect(await drain(result.stream)).toEqual(["chunk-a"]);
    expect(served).toBe("groq");
  });

  it("passes a healthy stream's chunks through in order (reconstruction is transparent)", async () => {
    vi.stubEnv("AI_PROVIDER_TIMEOUT_MS", "500");
    const healthy = streamModel(() => Promise.resolve({ stream: streamOf(["a", "b", "c"]) }));
    const unused = streamModel(() => Promise.reject(new Error("should not be reached")));
    const model = withFallback([entry("nvidia", healthy), entry("groq", unused)]);
    const result = (await model.doStream({} as Parameters<typeof model.doStream>[0])) as {
      stream: ReadableStream<unknown>;
    };
    expect(await drain(result.stream)).toEqual(["a", "b", "c"]);
  });

  it("rejects an empty chain loudly", () => {
    expect(() => withFallback([])).toThrow(/empty/i);
  });
});

describe("isProviderUnavailable (fallback trigger discrimination)", () => {
  it("treats 429 / quota / 5xx / auth / network as unavailable", () => {
    expect(isProviderUnavailable(apiCallError(429, "Too Many Requests", true))).toBe(true);
    expect(isProviderUnavailable(new Error("RESOURCE_EXHAUSTED: quota"))).toBe(true);
    expect(isProviderUnavailable(apiCallError(503, "overloaded"))).toBe(true);
    expect(isProviderUnavailable(apiCallError(401, "bad key"))).toBe(true);
    expect(isProviderUnavailable(new TypeError("fetch failed"))).toBe(true);
  });

  it("does NOT treat request/validation-shaped errors as unavailable", () => {
    expect(isProviderUnavailable(apiCallError(400, "invalid argument"))).toBe(false);
    expect(isProviderUnavailable(new Error("schema validation failed"))).toBe(false);
  });
});
