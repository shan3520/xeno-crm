/// <reference types="vitest/globals" />
import { APICallError } from "ai";

import { isRateLimited, toToolFailure } from "@/lib/ai/errors";

describe("rate-limit degradation (simulated 429)", () => {
  const apiCallError = (status: number, message: string): APICallError =>
    new APICallError({
      message,
      url: "https://generativelanguage.googleapis.com",
      requestBodyValues: {},
      statusCode: status,
      isRetryable: status === 429,
    });

  it("detects a 429 APICallError as rate-limited", () => {
    expect(isRateLimited(apiCallError(429, "Too Many Requests"))).toBe(true);
  });

  it("detects RESOURCE_EXHAUSTED / quota text as rate-limited", () => {
    expect(isRateLimited(new Error("RESOURCE_EXHAUSTED: quota exceeded"))).toBe(true);
    expect(isRateLimited(new Error("429 rate limit hit"))).toBe(true);
  });

  it("does NOT flag unrelated errors", () => {
    expect(isRateLimited(new Error("network down"))).toBe(false);
    expect(isRateLimited(apiCallError(500, "Internal Error"))).toBe(false);
  });

  it("toToolFailure degrades a 429 to a typed retry result, never throwing", () => {
    const failure = toToolFailure(apiCallError(429, "RESOURCE_EXHAUSTED"));
    expect(failure).toEqual({
      ok: false,
      error: "rate_limited",
      message: expect.stringContaining("rate-limited"),
    });
  });

  it("toToolFailure maps other errors to a generic typed failure", () => {
    expect(toToolFailure(new Error("boom"))).toEqual({
      ok: false,
      error: "failed",
      message: "boom",
    });
  });
});
