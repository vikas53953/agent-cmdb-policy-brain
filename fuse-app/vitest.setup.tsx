// Setup for the `interaction` test project (jsdom component tests).
//
// Two jobs: give every test the jest-dom matchers (toBeDisabled, toBeVisible, ...)
// and unmount the React tree between tests so one test's DOM can never leak into the
// next one's queries.

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
