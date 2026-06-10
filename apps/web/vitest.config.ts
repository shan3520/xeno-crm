import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Unit tests for the AI orchestration's deterministic paths (schema validation, error
 * degradation, JSON parsing) — no Gemini calls, no network. The `@/` alias mirrors tsconfig.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ["lib/**/*.spec.ts"],
  },
});
