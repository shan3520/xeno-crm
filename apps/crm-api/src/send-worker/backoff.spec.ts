/// <reference types="vitest/globals" />
import {
  backoffCeiling,
  backoffDelayMs,
  BASE_BACKOFF_MS,
  LEASE_MS,
  MAX_BACKOFF_MS,
} from "./backoff";

describe("backoff", () => {
  describe("backoffCeiling", () => {
    it("grows exponentially from the base", () => {
      expect(backoffCeiling(1)).toBe(BASE_BACKOFF_MS); // 1000
      expect(backoffCeiling(2)).toBe(BASE_BACKOFF_MS * 2); // 2000
      expect(backoffCeiling(3)).toBe(BASE_BACKOFF_MS * 4); // 4000
      expect(backoffCeiling(4)).toBe(BASE_BACKOFF_MS * 8); // 8000
    });

    it("is monotonically non-decreasing", () => {
      let prev = 0;
      for (let attempt = 1; attempt <= 20; attempt++) {
        const ceil = backoffCeiling(attempt);
        expect(ceil).toBeGreaterThanOrEqual(prev);
        prev = ceil;
      }
    });

    it("caps at MAX_BACKOFF_MS for large attempts", () => {
      expect(backoffCeiling(50)).toBe(MAX_BACKOFF_MS);
    });
  });

  describe("backoffDelayMs (equal jitter)", () => {
    it("stays within [ceiling/2, ceiling] for any rng output", () => {
      for (let attempt = 1; attempt <= 6; attempt++) {
        const ceil = backoffCeiling(attempt);
        expect(backoffDelayMs(attempt, () => 0)).toBe(Math.round(ceil / 2));
        expect(backoffDelayMs(attempt, () => 1)).toBe(ceil);
        const mid = backoffDelayMs(attempt, () => 0.5);
        expect(mid).toBeGreaterThanOrEqual(ceil / 2);
        expect(mid).toBeLessThanOrEqual(ceil);
      }
    });

    it("a higher attempt's minimum delay exceeds a lower attempt's (growing nextAttemptAt)", () => {
      const lowMax = backoffDelayMs(1, () => 1); // ceiling at attempt 1
      const highMin = backoffDelayMs(3, () => 0); // floor at attempt 3
      expect(highMin).toBeGreaterThan(lowMax);
    });
  });

  it("lease window is safely above the send timeout", () => {
    expect(LEASE_MS).toBeGreaterThan(10_000);
  });
});
