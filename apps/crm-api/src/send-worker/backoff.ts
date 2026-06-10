/**
 * Pure lease + backoff math for the send-queue worker. No DB, no Nest — unit-tested.
 *
 * LEASE_MS — the claim lease window. A worker that claims a Communication stamps
 * `lockedAt = now`; the claim predicate only reclaims a leased row once
 * `lockedAt < now - LEASE_MS`. Chosen at 60s: comfortably longer than a single send
 * attempt (SEND_TIMEOUT_MS = 10s) so a healthy worker always finishes inside its lease,
 * yet short enough that a CRASHED worker's in-flight rows become reclaimable within a
 * minute. The trade-off: a longer lease delays recovery from crashes; a shorter one risks
 * a slow send being reclaimed and double-sent. 60s sits safely above the 10s send ceiling.
 */
export const LEASE_MS = 60_000;

/** Backoff base: first retry waits ~1s (after equal jitter). */
export const BASE_BACKOFF_MS = 1_000;
/** Exponential growth factor per attempt. */
export const BACKOFF_FACTOR = 2;
/** Cap so very high attempt counts don't push retries hours out. */
export const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Deterministic exponential ceiling for a given (1-based) attempt number, capped at
 * MAX_BACKOFF_MS. attempt 1 -> BASE, 2 -> BASE*2, 3 -> BASE*4, …
 */
export function backoffCeiling(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = BASE_BACKOFF_MS * Math.pow(BACKOFF_FACTOR, exponent);
  return Math.min(MAX_BACKOFF_MS, raw);
}

/**
 * Backoff delay (ms) for a failed attempt, using "equal jitter": half the ceiling fixed
 * plus a random component up to the other half. Spreads retries so a fleet of workers
 * doesn't thunder back at the stub in lockstep. `rng` is injectable for deterministic tests.
 */
export function backoffDelayMs(attempt: number, rng: () => number = Math.random): number {
  const ceiling = backoffCeiling(attempt);
  const half = ceiling / 2;
  return Math.round(half + rng() * half);
}
