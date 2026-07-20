import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// TWO TEST PROJECTS, one command.
//
//   • units — the pure `*.test.ts` logic tests, in plain node. Untouched: same
//     environment, same include, same excludes as before.
//   • interaction — `*.test.tsx` component tests in jsdom, driving REAL clicks
//     through @testing-library/user-event.
//
// WHY the second project exists (the class gap it closes): before this, the app had
// no way to catch ANY interaction bug. Every test was pure logic, so a control that
// silently discards the user's first click — the F-2 family: Create, delete, and the
// mini-player play button all needing two taps — could not be reproduced by anything
// except a human clicking. A bug class with no test surface is a bug class that keeps
// coming back. These tests click the real components the way a person does.
//
// They are kept as a SEPARATE project rather than flipping the global environment to
// jsdom so the logic tests keep running in the environment they were written for.

const alias = {
  // Mirror the tsconfig "@/*" path alias so tests import modules the same way
  // production code does (e.g. `@/lib/security-headers`).
  "@": fileURLToPath(new URL(".", import.meta.url)),
};

// Never sweep the Next build output or the Playwright e2e specs into the unit run.
const exclude = [...configDefaults.exclude, ".next/**", "e2e/**"];

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "units",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "interaction",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
          exclude,
          setupFiles: ["./vitest.setup.tsx"],
        },
      },
    ],
  },
});
