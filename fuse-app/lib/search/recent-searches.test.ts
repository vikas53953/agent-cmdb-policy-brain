import { describe, expect, it } from "vitest";
import {
  loadRecentSearches,
  addRecentSearch,
  clearRecentSearches,
  RECENT_SEARCH_MAX,
  type SimpleStorage,
} from "@/lib/search/recent-searches";

// A Map-backed fake of the tiny storage slice we use.
function fakeStore(): SimpleStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("recent-searches (Wave 1 — per-user, capped, de-duped)", () => {
  it("adds newest-first and reads back", () => {
    const s = fakeStore();
    addRecentSearch(s, "u1", "daft punk");
    addRecentSearch(s, "u1", "aphex twin");
    expect(loadRecentSearches(s, "u1")).toEqual(["aphex twin", "daft punk"]);
  });

  it("de-dupes case-insensitively, moving a repeat to the top", () => {
    const s = fakeStore();
    addRecentSearch(s, "u1", "Daft Punk");
    addRecentSearch(s, "u1", "aphex twin");
    addRecentSearch(s, "u1", "daft punk");
    expect(loadRecentSearches(s, "u1")).toEqual(["daft punk", "aphex twin"]);
  });

  it("ignores empty/whitespace queries", () => {
    const s = fakeStore();
    addRecentSearch(s, "u1", "   ");
    expect(loadRecentSearches(s, "u1")).toEqual([]);
  });

  it("caps the list length", () => {
    const s = fakeStore();
    for (let i = 0; i < RECENT_SEARCH_MAX + 5; i++) addRecentSearch(s, "u1", `q${i}`);
    expect(loadRecentSearches(s, "u1")).toHaveLength(RECENT_SEARCH_MAX);
    expect(loadRecentSearches(s, "u1")[0]).toBe(`q${RECENT_SEARCH_MAX + 4}`);
  });

  it("keeps each user's history separate on a shared browser", () => {
    const s = fakeStore();
    addRecentSearch(s, "u1", "jazz");
    addRecentSearch(s, "u2", "techno");
    expect(loadRecentSearches(s, "u1")).toEqual(["jazz"]);
    expect(loadRecentSearches(s, "u2")).toEqual(["techno"]);
  });

  it("clear empties only that user's list", () => {
    const s = fakeStore();
    addRecentSearch(s, "u1", "jazz");
    addRecentSearch(s, "u2", "techno");
    clearRecentSearches(s, "u1");
    expect(loadRecentSearches(s, "u1")).toEqual([]);
    expect(loadRecentSearches(s, "u2")).toEqual(["techno"]);
  });

  it("degrades to empty when storage is unavailable (null), never throws", () => {
    expect(loadRecentSearches(null, "u1")).toEqual([]);
    expect(addRecentSearch(null, "u1", "x")).toEqual([]);
    expect(clearRecentSearches(null, "u1")).toEqual([]);
  });
});
