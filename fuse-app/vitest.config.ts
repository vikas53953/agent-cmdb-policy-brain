import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Mirror the tsconfig "@/*" path alias so tests import modules the same way
    // production code does (e.g. `@/lib/security-headers`).
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // Node env for the colocated `*.test.ts` unit tests. Component/jsdom tests
    // arrive with the units that need them.
    environment: "node",
    include: ["**/*.test.ts"],
    // Keep vitest's defaults and never sweep the Next build output or Playwright
    // e2e specs into the unit run.
    exclude: [...configDefaults.exclude, ".next/**", "e2e/**"],
  },
});
