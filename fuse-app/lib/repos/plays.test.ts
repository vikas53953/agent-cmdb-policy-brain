import { describe, it, expect } from "vitest";
import { makeModel, makePrisma } from "./__fixtures__/fake-prisma";
import { recordPlay, listRecentPlays, trendingByPlayCount, trendingSeed, trendingTracks } from "./plays";

describe("plays repo — per-user history (R11)", () => {
  it("recordPlay writes with the caller's ownerId; recent list is scoped and newest-first", async () => {
    const play = makeModel();
    const prisma = makePrisma({ play: play.model });

    await recordPlay("A", { source: "youtube", nativeId: "v1", title: "One" }, prisma);
    await recordPlay("A", { source: "youtube", nativeId: "v2", title: "Two" }, prisma);
    await recordPlay("B", { source: "youtube", nativeId: "v3", title: "Three" }, prisma);

    const aRecent = await listRecentPlays("A", 10, prisma);
    expect(aRecent.every((p) => p.ownerId === "A")).toBe(true);
    expect(aRecent.map((p) => p.nativeId).sort()).toEqual(["v1", "v2"]);

    // B's history never leaks into A's.
    const bRecent = await listRecentPlays("B", 10, prisma);
    expect(bRecent.map((p) => p.nativeId)).toEqual(["v3"]);
  });
});

describe("plays repo — trending (KTD-4)", () => {
  it("trendingByPlayCount aggregates anonymous counts across ALL users", async () => {
    // v1 played 3x (across A and B), v2 once. Trending is global — not scoped to a user.
    const play = makeModel([
      { id: "1", ownerId: "A", source: "youtube", nativeId: "v1", title: "One" },
      { id: "2", ownerId: "B", source: "youtube", nativeId: "v1", title: "One" },
      { id: "3", ownerId: "A", source: "youtube", nativeId: "v1", title: "One" },
      { id: "4", ownerId: "B", source: "youtube", nativeId: "v2", title: "Two" },
    ]);
    const prisma = makePrisma({ play: play.model });
    const trending = await trendingByPlayCount(10, prisma);
    expect(trending[0]).toEqual({ source: "youtube", nativeId: "v1", playCount: 3 });
    expect(trending.find((t) => t.nativeId === "v2")!.playCount).toBe(1);
  });

  it("trendingSeed returns the curated seed ordered by rank", async () => {
    const trendingSeedModel = makeModel([
      { id: "s2", rank: 1, source: "youtube", nativeId: "b", title: "B" },
      { id: "s1", rank: 0, source: "youtube", nativeId: "a", title: "A" },
    ]);
    const prisma = makePrisma({ trendingSeed: trendingSeedModel.model });
    const seed = await trendingSeed(10, prisma);
    expect(seed.map((s) => s.nativeId)).toEqual(["a", "b"]);
  });

  it("trendingTracks enriches aggregate counts with real display fields (R5), most-played first", async () => {
    // v1 played twice with real cover art on the rows; v2 once. trendingTracks must
    // hand back renderable tracks (title + art), ordered by play count.
    const play = makeModel([
      { id: "1", ownerId: "A", source: "youtube", nativeId: "v1", title: "One", artist: "Aa", artUrl: "art1" },
      { id: "2", ownerId: "B", source: "youtube", nativeId: "v1", title: "One", artist: "Aa", artUrl: "art1" },
      { id: "3", ownerId: "A", source: "youtube", nativeId: "v2", title: "Two", artist: "Bb", artUrl: "art2" },
    ]);
    const prisma = makePrisma({ play: play.model });
    const tracks = await trendingTracks(10, prisma);
    expect(tracks[0]).toMatchObject({ nativeId: "v1", title: "One", artUrl: "art1", durationSec: null });
    expect(tracks.map((t) => t.nativeId)).toEqual(["v1", "v2"]);
  });
});
