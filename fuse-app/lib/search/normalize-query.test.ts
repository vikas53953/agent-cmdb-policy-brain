import { describe, expect, it } from "vitest";
import {
  normalizeSearchQuery,
  MAX_SEARCH_QUERY_LENGTH,
} from "@/lib/search/normalize-query";

describe("normalizeSearchQuery (F2 — the one shared cap for client + server)", () => {
  it("returns '' for an empty string", () => {
    expect(normalizeSearchQuery("")).toBe("");
  });

  it("returns '' for whitespace-only input (a no-op, not an error)", () => {
    expect(normalizeSearchQuery("   \t \n  ")).toBe("");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeSearchQuery("  paper cities  ")).toBe("paper cities");
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(normalizeSearchQuery("paper\t\t  cities\n\nsong")).toBe(
      "paper cities song",
    );
  });

  it("leaves a normal query untouched", () => {
    expect(normalizeSearchQuery("Radiohead - Weird Fishes")).toBe(
      "Radiohead - Weird Fishes",
    );
  });

  it("preserves the user's original casing (unlike the cache-key normalizer)", () => {
    expect(normalizeSearchQuery("The XX")).toBe("The XX");
  });

  it("caps over-long input silently at the max length", () => {
    const long = "a".repeat(MAX_SEARCH_QUERY_LENGTH + 120);
    const out = normalizeSearchQuery(long);
    expect(out.length).toBe(MAX_SEARCH_QUERY_LENGTH);
    expect(out).toBe("a".repeat(MAX_SEARCH_QUERY_LENGTH));
  });

  it("does not leave a dangling trailing space when the cap lands on a space", () => {
    // Word boundary sits exactly at the cap so the char after the cut is a space.
    const raw = "x".repeat(MAX_SEARCH_QUERY_LENGTH) + " tail";
    expect(normalizeSearchQuery(raw)).toBe("x".repeat(MAX_SEARCH_QUERY_LENGTH));
  });

  it("keeps a script-like query AS TEXT (escaped downstream, never executed)", () => {
    // The point of this test: normalization does NOT strip or mangle these
    // characters — it only bounds length. Safety is the caller's escaping job.
    const script = '<script>alert("x")</script> song';
    expect(normalizeSearchQuery(script)).toBe(
      '<script>alert("x")</script> song',
    );
  });

  it("caps a script-like over-long paste to the max length like any other input", () => {
    const raw = '<script>'.repeat(50); // ~400 chars
    const out = normalizeSearchQuery(raw);
    expect(out.length).toBe(MAX_SEARCH_QUERY_LENGTH);
  });
});
