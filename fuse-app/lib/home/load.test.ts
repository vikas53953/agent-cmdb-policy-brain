// Fix A: a failed read must be distinguishable from an empty one.
//
// These tests exist because the old loaders answered a database outage with the SAME
// value they answer an empty account with — so the UI told a user with 200 liked songs
// that they had none. The assertion that matters is not "the app didn't crash", it is
// "the app said it failed".

import { describe, it, expect } from "vitest";
import {
  loadHomeFeed,
  loadLibraryData,
  type HomeDeps,
  type LibraryDeps,
} from "./load";

type SessionUser = { id: string; email: string | null; name: string | null; image: string | null };
const USER: SessionUser = { id: "A", email: "a@example.com", name: "A", image: null };

const LIKE_ROW = {
  id: "l1",
  source: "youtube",
  nativeId: "v1",
  title: "One",
  artist: "Aa",
  artUrl: "art1",
  durationSec: null,
};

const PLAY_ROW = { source: "youtube", nativeId: "v2", title: "Two", artist: "Bb", artUrl: null };

function homeDeps(over: Partial<HomeDeps> = {}): HomeDeps {
  return {
    getUser: async () => USER,
    listLikes: async () => [LIKE_ROW],
    listRecentPlays: async () => [PLAY_ROW],
    // Added since B wrote this file: main's loader also reads raw play events for the
    // co-play affinity signal, so the dep set has to include it.
    listRecentPlayEvents: async () => [],
    trendingSeed: async () => [],
    trendingTracks: async () => [],
    ...over,
  };
}

function libraryDeps(over: Partial<LibraryDeps> = {}): LibraryDeps {
  return {
    getUser: async () => USER,
    listLikes: async () => [LIKE_ROW],
    listPlaylists: async () => [],
    ...over,
  };
}

const boom = async () => {
  throw new Error("db unreachable");
};

describe("loadHomeFeed — failure is not emptiness (A)", () => {
  it("reports status 'failed' when a read throws, instead of an empty feed", async () => {
    const result = await loadHomeFeed(homeDeps({ listLikes: boom }));
    // THE regression guard: the old code returned EMPTY_HOME here with no way to tell.
    expect(result.status).toBe("failed");
  });

  it("reports status 'failed' when the session read itself throws", async () => {
    const result = await loadHomeFeed(homeDeps({ getUser: boom }));
    expect(result.status).toBe("failed");
  });

  it("a genuinely empty account is 'ok', not 'failed' — the two must not collapse", async () => {
    const result = await loadHomeFeed(
      homeDeps({
        listLikes: async () => [],
        listRecentPlays: async () => [],
      }),
    );
    expect(result.status).toBe("ok");
    expect(result.data.recentlyPlayed).toEqual([]);
  });

  it("a signed-out render is an honest generic home, not a failure", async () => {
    const result = await loadHomeFeed(homeDeps({ getUser: async () => null }));
    expect(result.status).toBe("ok");
    expect(result.data.personalised).toBe(false);
    // Seed data can never name itself "Trending" (KTD-4) — pinned here because the
    // signed-out path is the one place that hard-codes the flag.
    expect(result.data.trendingIsReal).toBe(false);
  });

  it("still returns a renderable fallback on failure so the shell never crashes", async () => {
    const result = await loadHomeFeed(homeDeps({ trendingTracks: boom }));
    expect(result.data).toEqual({
      recentlyPlayed: [],
      trending: [],
      recommended: [],
      personalised: false,
    });
  });

  it("a missing co-play signal degrades the ranking, it does NOT fail the feed", async () => {
    // Added on top of B's set: main's loader gained a co-play read after B branched,
    // and it is deliberately allowed to fail on its own. A recommendation signal going
    // missing must never cost the user their whole home feed.
    const result = await loadHomeFeed(homeDeps({ listRecentPlayEvents: boom }));
    expect(result.status).toBe("ok");
    expect(result.data.recentlyPlayed.map((t) => t.nativeId)).toEqual(["v2"]);
  });
});

describe("loadLibraryData — failure is not emptiness (A)", () => {
  it("reports status 'failed' when the likes read throws", async () => {
    const result = await loadLibraryData(libraryDeps({ listLikes: boom }));
    expect(result.status).toBe("failed");
  });

  it("reports status 'failed' when the playlists read throws", async () => {
    const result = await loadLibraryData(libraryDeps({ listPlaylists: boom }));
    expect(result.status).toBe("failed");
  });

  it("a user with no saves is 'ok' with empty lists — never confused with an outage", async () => {
    const result = await loadLibraryData(libraryDeps({ listLikes: async () => [] }));
    expect(result.status).toBe("ok");
    expect(result.data.likes).toEqual([]);
  });

  it("a real library comes back as 'ok' with the user's likes", async () => {
    const result = await loadLibraryData(libraryDeps());
    expect(result.status).toBe("ok");
    expect(result.data.likes.map((l) => l.nativeId)).toEqual(["v1"]);
  });
});
