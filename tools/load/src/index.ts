/**
 * Placeholder for the load + chaos harness.
 *
 * In a later prompt this will push N communications through
 * launch -> channel-stub -> receipts and assert the correctness invariants
 * (idempotency, monotonic status, counter == event-aggregate). For now it is an
 * empty, typechecking stub so the workspace stays green.
 */
import { ChannelSchema } from "@xeno/shared";

export const LOAD_STUB = true as const;

export function main(): void {
  // eslint-disable-next-line no-console
  console.log(`@xeno/load stub (channels: ${ChannelSchema.options.join(", ")})`);
}
