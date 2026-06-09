/**
 * @xeno/shared — the single source of truth for cross-app contracts.
 *
 * Real Zod schemas, the segment DSL, channel/status enums and DTO types land in
 * a later prompt and are FROZEN after the skeleton phase. For now this just proves
 * that every app can import `@xeno/shared` and that the package builds + typechecks.
 */
export const SHARED_OK = true as const;
