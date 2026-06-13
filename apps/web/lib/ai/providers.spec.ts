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
