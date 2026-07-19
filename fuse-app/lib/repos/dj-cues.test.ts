import { describe, it, expect } from "vitest";
import { makeModel, makePrisma } from "./__fixtures__/fake-prisma";
import { listCues, setCue, deleteCue, isValidSlot, MAX_CUE_SLOTS } from "./dj-cues";

// Seed: user A has one cue on a local track; user B has none. Proves cross-tenant
// isolation (R8/R15) the same way the likes repo test does.
function db() {
  const cueModel = makeModel([
    {
      id: "c1",
      ownerId: "A",
      source: "local",
      nativeId: "fp-track-1",
      slot: 0,
      positionSec: 12.5,
      label: null,
      createdAt: new Date("2026-07-01"),
    },
  ]);
  return { prisma: makePrisma({ djCue: cueModel.model }), cueModel };
}

const TRACK = { source: "local", nativeId: "fp-track-1" } as const;

describe("dj-cues slot validation", () => {
  it("accepts the four DJ-1 pads and rejects anything else", () => {
    expect(MAX_CUE_SLOTS).toBe(4);
    for (const s of [0, 1, 2, 3]) expect(isValidSlot(s)).toBe(true);
    for (const s of [-1, 4, 1.5, Number.NaN]) expect(isValidSlot(s)).toBe(false);
  });
});

describe("dj-cues repo isolation", () => {
  it("user B sees none of user A's cues (cross-tenant read returns empty)", async () => {
    const { prisma } = db();
    const aCues = await listCues("A", TRACK, prisma);
    expect(aCues.map((r) => r.id)).toEqual(["c1"]);

    const bCues = await listCues("B", TRACK, prisma);
    expect(bCues).toEqual([]);
  });

  it("cues are scoped to the exact track, not shared across tracks", async () => {
    const { prisma } = db();
    const other = await listCues("A", { source: "local", nativeId: "fp-other" }, prisma);
    expect(other).toEqual([]);
  });
});

describe("dj-cues writes", () => {
  it("setCue attributes the cue to the caller and is idempotent per slot (upsert)", async () => {
    const { prisma, cueModel } = db();
    await setCue("B", TRACK, 1, 30, prisma);
    const bCues = await listCues("B", TRACK, prisma);
    expect(bCues).toHaveLength(1);
    expect(bCues[0].ownerId).toBe("B");
    expect(bCues[0].positionSec).toBe(30);

    // Re-setting the same pad MOVES it (updates position) rather than duplicating.
    await setCue("B", TRACK, 1, 45, prisma);
    const after = await listCues("B", TRACK, prisma);
    expect(after).toHaveLength(1);
    expect(after[0].positionSec).toBe(45);
    expect(cueModel.calls.upsert).toHaveLength(2);
  });

  it("a set/jump/delete round-trip works and is honest about counts", async () => {
    const { prisma } = db();
    // B sets a cue (the "set" a DJ does on the drop).
    await setCue("B", TRACK, 2, 60, prisma);
    // "Jump" reads it back — the position the deck would seek to.
    const [cue] = await listCues("B", TRACK, prisma);
    expect(cue.positionSec).toBe(60);
    // Delete clears exactly that pad.
    expect(await deleteCue("B", TRACK, 2, prisma)).toBe(1);
    expect(await listCues("B", TRACK, prisma)).toEqual([]);
  });

  it("deleting another user's cue removes nothing", async () => {
    const { prisma } = db();
    // B tries to clear A's pad 0 → keyed on ownerId, so zero rows.
    expect(await deleteCue("B", TRACK, 0, prisma)).toBe(0);
    expect(await listCues("A", TRACK, prisma)).toHaveLength(1); // A's cue intact

    // A clears their own pad.
    expect(await deleteCue("A", TRACK, 0, prisma)).toBe(1);
    expect(await listCues("A", TRACK, prisma)).toEqual([]);
  });

  it("clamps a negative or non-finite position to 0 instead of persisting junk", async () => {
    const { prisma } = db();
    await setCue("B", TRACK, 0, -5, prisma);
    const [cue] = await listCues("B", TRACK, prisma);
    expect(cue.positionSec).toBe(0);
  });
});
