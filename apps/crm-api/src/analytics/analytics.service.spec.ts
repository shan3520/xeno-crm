/// <reference types="vitest/globals" />
import { computeRates, pivotTimeline } from "./analytics.service";
import type { FunnelCounts, TimelineBucket } from "./analytics.types";

describe("AnalyticsService pure helpers", () => {
  // ─── computeRates ───────────────────────────────────────────────

  describe("computeRates", () => {
    it("computes rates from non-zero funnel", () => {
      const funnel: FunnelCounts = {
        queued: 1000,
        sent: 900,
        delivered: 800,
        opened: 400,
        read: 200,
        clicked: 100,
        converted: 50,
        failed: 100,
      };

      const rates = computeRates(funnel);

      expect(rates.deliveryRate).toBeCloseTo(800 / 900, 4);
      expect(rates.openRate).toBeCloseTo(400 / 800, 4);
      expect(rates.clickRate).toBeCloseTo(100 / 400, 4);
      expect(rates.conversionRate).toBeCloseTo(50 / 800, 4);
    });

    it("returns all zeros when funnel is empty", () => {
      const funnel: FunnelCounts = {
        queued: 0,
        sent: 0,
        delivered: 0,
        opened: 0,
        read: 0,
        clicked: 0,
        converted: 0,
        failed: 0,
      };

      const rates = computeRates(funnel);

      expect(rates.deliveryRate).toBe(0);
      expect(rates.openRate).toBe(0);
      expect(rates.clickRate).toBe(0);
      expect(rates.conversionRate).toBe(0);
    });

    it("handles partial funnel (sent but no deliveries)", () => {
      const funnel: FunnelCounts = {
        queued: 100,
        sent: 50,
        delivered: 0,
        opened: 0,
        read: 0,
        clicked: 0,
        converted: 0,
        failed: 50,
      };

      const rates = computeRates(funnel);

      expect(rates.deliveryRate).toBe(0);
      expect(rates.openRate).toBe(0);
      expect(rates.clickRate).toBe(0);
      expect(rates.conversionRate).toBe(0);
    });
  });

  // ─── pivotTimeline ──────────────────────────────────────────────

  describe("pivotTimeline", () => {
    it("pivots grouped rows into timeline buckets", () => {
      const rows = [
        { bucket: new Date("2026-06-01T10:00:00Z"), type: "SENT", count: 10n },
        { bucket: new Date("2026-06-01T10:00:00Z"), type: "DELIVERED", count: 8n },
        { bucket: new Date("2026-06-01T10:00:00Z"), type: "FAILED", count: 2n },
        { bucket: new Date("2026-06-01T11:00:00Z"), type: "SENT", count: 5n },
        { bucket: new Date("2026-06-01T11:00:00Z"), type: "OPENED", count: 3n },
      ];

      const result = pivotTimeline(rows);

      expect(result).toHaveLength(2);

      const first = result[0] as TimelineBucket;
      expect(first.bucket).toBe("2026-06-01T10:00:00.000Z");
      expect(first.sent).toBe(10);
      expect(first.delivered).toBe(8);
      expect(first.failed).toBe(2);
      expect(first.opened).toBe(0);
      expect(first.clicked).toBe(0);

      const second = result[1] as TimelineBucket;
      expect(second.sent).toBe(5);
      expect(second.opened).toBe(3);
      expect(second.delivered).toBe(0);
    });

    it("returns empty array for no rows", () => {
      expect(pivotTimeline([])).toEqual([]);
    });

    it("handles duplicate type entries in the same bucket by summing", () => {
      const rows = [
        { bucket: new Date("2026-06-01T10:00:00Z"), type: "SENT", count: 5n },
        { bucket: new Date("2026-06-01T10:00:00Z"), type: "SENT", count: 3n },
      ];

      const result = pivotTimeline(rows);

      expect(result).toHaveLength(1);
      expect(result[0]!.sent).toBe(8);
    });
  });
});
