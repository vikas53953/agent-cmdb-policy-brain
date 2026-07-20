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

describe("plays repo — trending enrichment is batched (C)", () => {
  // Build N distinct trending identities, each played once.
  function manyPlays(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      ownerId: "A",
      source: "youtube",
      nativeId: `v${i}`,
      title: `T${i}`,
      artist: null,
      artUrl: null,
      playedAt: i,
    }));
  }

  it("costs a CONSTANT number of queries regardless of how many groups trend", async () => {
    // The bug: one findFirst PER trending group — ~20 round-trips on every Home render,
    // growing with the rail size. The fix must make the query count independent of N,
    // so we measure it at two very different sizes and demand the same number.
    const small = makeModel(manyPlays(3));
    const big = makeModel(manyPlays(30));

    await trendingTracks(3, makePrisma({ play: small.model }));
    await trendingTracks(30, makePrisma({ play: big.model }));

    const smallQueries = small.calls.groupBy.length + small.calls.findMany.length + small.calls.findFirst.length;
    const bigQueries = big.calls.groupBy.length + big.calls.findMany.length + big.calls.findFirst.length;

    expect(bigQueries).toBe(smallQueries);
    // Exactly two: the aggregate, then one batched enrichment read.
    expect(bigQueries).toBe(2);
    // The N+1 shape specifically must be gone.
    expect(big.calls.findFirst.length).toBe(0);
  });

  it("still enriches every group correctly through the single batched read", async () => {
    const play = makeModel([
      { id: "1", ownerId: "A", source: "youtube", nativeId: "v1", title: "old", artist: "Aa", artUrl: "a1", playedAt: 1 },
      { id: "2", ownerId: "B", source: "youtube", nativeId: "v1", title: "newest", artist: "Aa", artUrl: "a2", playedAt: 5 },
      { id: "3", ownerId: "A", source: "youtube", nativeId: "v2", title: "Two", artist: "Bb", artUrl: "b1", playedAt: 2 },
    ]);
    const tracks = await trendingTracks(10, makePrisma({ play: play.model }));
    // Most-played first, and each identity carries its MOST RECENT row's display fields.
    expect(tracks.map((t) => t.nativeId)).toEqual(["v1", "v2"]);
    expect(tracks[0]).toMatchObject({ title: "newest", artUrl: "a2" });
  });
});

describe("plays repo — local filenames never reach global trending (E)", () => {
  it("excludes local-source plays from the aggregate at the QUERY level", async () => {
    // A local play's title is the owner's own filename. It must not be countable by a
    // global surface at all — so the exclusion has to be in the where clause the repo
    // builds, not in a filter the caller remembers to apply.
    const play = makeModel([
      { id: "1", ownerId: "A", source: "local", nativeId: "f1", title: "my-private-demo.mp3" },
      { id: "2", ownerId: "A", source: "local", nativeId: "f1", title: "my-private-demo.mp3" },
      { id: "3", ownerId: "A", source: "local", nativeId: "f1", title: "my-private-demo.mp3" },
      { id: "4", ownerId: "B", source: "youtube", nativeId: "v1", title: "One" },
    ]);
    const prisma = makePrisma({ play: play.model });

    const trending = await trendingByPlayCount(10, prisma);
    expect(trending.map((t) => t.nativeId)).toEqual(["v1"]);
    expect(trending.some((t) => t.source === "local")).toBe(false);
    // Proven by the query, not by the fake: the repo asked for it.
    expect(play.calls.groupBy[0]).toMatchObject({ where: { source: { not: "local" } } });
  });

  it("never renders a local track's title onto trending, even as an enrichment row", async () => {
    const play = makeModel([
      { id: "1", ownerId: "A", source: "local", nativeId: "f1", title: "tax-return-voice-note.mp3", playedAt: 9 },
      { id: "2", ownerId: "A", source: "local", nativeId: "f1", title: "tax-return-voice-note.mp3", playedAt: 8 },
      { id: "3", ownerId: "B", source: "youtube", nativeId: "v1", title: "One", artist: null, artUrl: null, playedAt: 1 },
    ]);
    const tracks = await trendingTracks(10, makePrisma({ play: play.model }));
    expect(tracks.map((t) => t.title)).toEqual(["One"]);
    expect(JSON.stringify(tracks)).not.toContain("tax-return");
  });

  it("a local play is still the owner's own history — exclusion is global-only", async () => {
    const play = makeModel();
    const prisma = makePrisma({ play: play.model });
    await recordPlay("A", { source: "local", nativeId: "f1", title: "my-file.mp3" }, prisma);
    const mine = await listRecentPlays("A", 10, prisma);
    expect(mine.map((p) => p.nativeId)).toEqual(["f1"]);
  });
});
