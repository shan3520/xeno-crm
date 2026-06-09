import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
}

/** Per-request store so any log line (controller, service, filter) can stamp the requestId. */
export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestId(): string | null {
  return requestContext.getStore()?.requestId ?? null;
}
