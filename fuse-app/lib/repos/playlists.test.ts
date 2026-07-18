import { describe, it, expect } from "vitest";
import { makeModel, makePrisma } from "./__fixtures__/fake-prisma";
import {
  listPlaylists,
  getPlaylist,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  addTrack,
  removeTrack,
  reorderTracks,
} from "./playlists";

// A owns p1; B owns p2. The repo uses `include: { tracks }`, which the generic fake
// ignores; wrap the playlist delegate so findFirst/findMany attach the playlist's
// tracks (ordered by position) from the playlistTrack store, matching real Prisma.
function db(seedTracks: Record<string, unknown>[] = []) {
  const playlist = makeModel([
    { id: "p1", ownerId: "A", name: "A list", createdAt: new Date("2026-07-01") },
    { id: "p2", ownerId: "B", name: "B list", createdAt: new Date("2026-07-02") },
  ]);
  const playlistTrack = makeModel(seedTracks);

  const attachTracks = <T extends Record<string, unknown> | null>(row: T): T => {
    if (!row) return row;
    const tracks = playlistTrack.rows
      .filter((t) => t.playlistId === row.id)
      .sort((a, b) => (a.position as number) - (b.position as number))
      .map((t) => ({ ...t }));
    return { ...row, tracks } as T;
  };

  const base = playlist.model;
  const playlistWithTracks = {
    ...base,
    findFirst: async (a: Parameters<typeof base.findFirst>[0]) => attachTracks(await base.findFirst(a)),
    findMany: async (a: Parameters<typeof base.findMany>[0]) =>
      (await base.findMany(a)).map((r) => attachTracks(r)),
  } as typeof base;

  return {
    prisma: makePrisma({ playlist: playlistWithTracks, playlistTrack: playlistTrack.model }),
    playlist,
    playlistTrack,
  };
}

describe("playlists repo isolation (BOLA)", () => {
  it("A cannot delete B's playlist — zero rows affected, B's playlist intact", async () => {
    const { prisma } = db();
    const removed = await deletePlaylist("A", "p2", prisma);
    expect(removed).toBe(0);
    // B still owns p2.
    expect(await getPlaylist("B", "p2", prisma)).not.toBeNull();
  });

  it("A can delete their own playlist", async () => {
    const { prisma } = db();
    expect(await deletePlaylist("A", "p1", prisma)).toBe(1);
    expect(await getPlaylist("A", "p1", prisma)).toBeNull();
  });

  it("list is scoped to the caller", async () => {
    const { prisma } = db();
    expect((await listPlaylists("A", prisma)).map((p) => p.id)).toEqual(["p1"]);
    expect((await listPlaylists("B", prisma)).map((p) => p.id)).toEqual(["p2"]);
  });

  it("getPlaylist cannot read another user's playlist", async () => {
    const { prisma } = db();
    expect(await getPlaylist("A", "p2", prisma)).toBeNull();
  });

  it("rename of another user's playlist affects nothing and returns null", async () => {
    const { prisma, playlist } = db();
    expect(await renamePlaylist("A", "p2", "hijack", prisma)).toBeNull();
    expect(playlist.rows.find((r) => r.id === "p2")!.name).toBe("B list");
  });
});

describe("playlists repo create + tracks", () => {
  it("create sets ownerId to the caller", async () => {
    const { prisma, playlist } = db();
    await createPlaylist("A", "Fresh", prisma);
    const created = playlist.rows.find((r) => r.name === "Fresh")!;
    expect(created.ownerId).toBe("A");
  });

  it("addTrack refuses a playlist the caller does not own", async () => {
    const { prisma, playlistTrack } = db();
    const res = await addTrack("A", "p2", { source: "youtube", nativeId: "v1", title: "T" }, prisma);
    expect(res).toBeNull();
    expect(playlistTrack.rows).toHaveLength(0); // nothing written
  });

  it("addTrack appends with an incrementing position for an owned playlist", async () => {
    const { prisma, playlistTrack } = db();
    await addTrack("A", "p1", { source: "youtube", nativeId: "v1", title: "One" }, prisma);
    await addTrack("A", "p1", { source: "spotify", nativeId: "s2", title: "Two" }, prisma);
    const positions = playlistTrack.rows
      .filter((r) => r.playlistId === "p1")
      .map((r) => r.position)
      .sort();
    expect(positions).toEqual([0, 1]);
  });

  it("reorderTracks persists a new order and ignores foreign track ids", async () => {
    const { prisma } = db([
      { id: "t1", playlistId: "p1", position: 0, source: "youtube", nativeId: "v1", title: "One" },
      { id: "t2", playlistId: "p1", position: 1, source: "youtube", nativeId: "v2", title: "Two" },
      { id: "tX", playlistId: "p2", position: 0, source: "youtube", nativeId: "vx", title: "Foreign" },
    ]);
    // Ask to put t2 first, t1 second, and sneak in tX (from p2) — tX must be ignored.
    const result = await reorderTracks("A", "p1", ["t2", "t1", "tX"], prisma);
    expect(result).not.toBeNull();
    const order = result!.tracks.map((t) => t.id);
    expect(order).toEqual(["t2", "t1"]);
  });

  it("removeTrack re-packs positions gap-free", async () => {
    const { prisma } = db([
      { id: "t1", playlistId: "p1", position: 0, source: "youtube", nativeId: "v1", title: "One" },
      { id: "t2", playlistId: "p1", position: 1, source: "youtube", nativeId: "v2", title: "Two" },
      { id: "t3", playlistId: "p1", position: 2, source: "youtube", nativeId: "v3", title: "Three" },
    ]);
    expect(await removeTrack("A", "p1", "t2", prisma)).toBe(1);
    const remaining = await getPlaylist("A", "p1", prisma);
    expect(remaining!.tracks.map((t) => [t.id, t.position])).toEqual([
      ["t1", 0],
      ["t3", 1],
    ]);
  });

  it("removeTrack refuses a playlist the caller does not own", async () => {
    const { prisma, playlistTrack } = db([
      { id: "tX", playlistId: "p2", position: 0, source: "youtube", nativeId: "vx", title: "Foreign" },
    ]);
    expect(await removeTrack("A", "p2", "tX", prisma)).toBe(0);
    expect(playlistTrack.rows).toHaveLength(1); // untouched
  });
});
