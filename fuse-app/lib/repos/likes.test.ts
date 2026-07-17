import { describe, it, expect } from "vitest";
import { makeModel, makePrisma } from "./__fixtures__/fake-prisma";
import { listLikes, isLiked, like, unlike } from "./likes";

// Seed: user A has one like; user B has none. Proves cross-tenant isolation (R8/R15).
function db() {
  const likeModel = makeModel([
    {
      id: "l1",
      ownerId: "A",
      source: "youtube",
      nativeId: "vidA",
      title: "Song A",
      artist: "Artist A",
      artUrl: null,
      durationSec: 200,
      createdAt: new Date("2026-07-01"),
    },
  ]);
  return { prisma: makePrisma({ like: likeModel.model }), likeModel };
}

describe("likes repo isolation", () => {
  it("user B sees none of user A's likes (cross-tenant read returns empty)", async () => {
    const { prisma } = db();
    const aLikes = await listLikes("A", prisma);
    expect(aLikes.map((r) => r.id)).toEqual(["l1"]);

    const bLikes = await listLikes("B", prisma);
    expect(bLikes).toEqual([]);
  });

  it("isLiked is scoped to the caller", async () => {
    const { prisma } = db();
    expect(await isLiked("A", { source: "youtube", nativeId: "vidA" }, prisma)).toBe(true);
    expect(await isLiked("B", { source: "youtube", nativeId: "vidA" }, prisma)).toBe(false);
  });
});

describe("likes repo writes", () => {
  it("like sets ownerId to the caller and is idempotent (upsert)", async () => {
    const { prisma, likeModel } = db();
    await like("B", { source: "spotify", nativeId: "spB", title: "New" }, prisma);
    const bLikes = await listLikes("B", prisma);
    expect(bLikes).toHaveLength(1);
    expect(bLikes[0].ownerId).toBe("B");

    // Liking the same track again refreshes rather than duplicating.
    await like("B", { source: "spotify", nativeId: "spB", title: "New (updated)" }, prisma);
    expect(await listLikes("B", prisma)).toHaveLength(1);
    expect(likeModel.calls.upsert).toHaveLength(2);
  });

  it("unlike of another user's like removes nothing", async () => {
    const { prisma } = db();
    // B tries to unlike A's track — keyed on { ownerId, source, nativeId } → 0 rows.
    expect(await unlike("B", { source: "youtube", nativeId: "vidA" }, prisma)).toBe(0);
    expect(await listLikes("A", prisma)).toHaveLength(1); // A's like intact

    // A unliking their own track removes it.
    expect(await unlike("A", { source: "youtube", nativeId: "vidA" }, prisma)).toBe(1);
    expect(await listLikes("A", prisma)).toHaveLength(0);
  });
});
