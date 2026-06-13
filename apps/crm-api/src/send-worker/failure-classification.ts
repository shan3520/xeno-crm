/**
 * Pure classification of a channel-stub HTTP status into TRANSIENT vs PERMANENT — no DB, no
 * Nest, unit-tested. The send worker uses this to decide whether a failed send may consume the
 * dead-letter budget (see SendWorkerService.markFailure).
 *
 * Transient = the stub is waking or overloaded, not refusing the request, so retrying will
 * eventually succeed: 429 (throttle) and any 5xx (including Render free-tier cold-start
 * 502/503/504). These must NOT dead-letter — otherwise a ~50s cold start burns every retry and
 * kills a whole batch. Everything else (4xx like 400/401/403/404/422) is a permanent client
 * error that won't fix itself on retry, so it counts toward WORKER_MAX_ATTEMPTS and dead-letters.
 */
export function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
