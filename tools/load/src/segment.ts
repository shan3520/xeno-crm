import type { SegmentDefinition } from "@xeno/shared";

import type { CrmApiClient } from "./api";

/**
 * Size an audience to a target N using ONLY the public /segments/preview endpoint. The
 * segment is a single threshold on customer.total_spend: count(total_spend <= X) rises
 * monotonically with X, from the zero-order cohort up to the whole workspace. A binary
 * search finds the smallest threshold whose audience meets/exceeds N — "large enough to hit
 * N" without massively overshooting (overshoot = wasted sends at the worker's rate).
 *
 * EMAIL is chosen by the harness because every seeded customer has an email, so the audience
 * is fully reachable (no missing-address skips) and the load count is predictable.
 */

/** Upper bound for the spend threshold (rupees). Seeded spend is far below this. */
const SPEND_CEILING = 1_000_000_000;

export function spendAtMostDefinition(threshold: number): SegmentDefinition {
  return {
    op: "AND",
    conditions: [
      { field: "customer.total_spend", operator: "lte", value: threshold },
    ],
  };
}

export function matchAllDefinition(): SegmentDefinition {
  return {
    op: "AND",
    conditions: [{ field: "customer.total_spend", operator: "gte", value: 0 }],
  };
}

export interface SizedSegment {
  definition: SegmentDefinition;
  /** Audience the chosen definition compiles to (>= target unless the workspace is smaller). */
  count: number;
  /** True when the whole reachable workspace is still smaller than the requested N. */
  capped: boolean;
  /** Number of preview probes used (for observability). */
  probes: number;
}

/**
 * Find the smallest-overshoot segment whose audience is >= target. Returns the match-all
 * segment (capped) when even the whole workspace cannot reach target.
 */
export async function sizeSegmentForCount(
  api: CrmApiClient,
  target: number,
): Promise<SizedSegment> {
  let probes = 0;
  const preview = async (def: SegmentDefinition): Promise<number> => {
    probes++;
    return (await api.previewSegment(def)).count;
  };

  const maxAudience = await preview(matchAllDefinition());
  if (target >= maxAudience) {
    return { definition: matchAllDefinition(), count: maxAudience, capped: true, probes };
  }

  // Smallest acceptable overshoot before we stop searching.
  const tolerance = Math.max(10, Math.ceil(target * 0.05));

  let lo = 0;
  let hi = SPEND_CEILING;
  let best = matchAllDefinition();
  let bestCount = maxAudience;

  for (let i = 0; i < 40 && lo <= hi; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const count = await preview(spendAtMostDefinition(mid));
    if (count >= target) {
      best = spendAtMostDefinition(mid);
      bestCount = count;
      if (count <= target + tolerance) break; // close enough — stop probing
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  return { definition: best, count: bestCount, capped: false, probes };
}
