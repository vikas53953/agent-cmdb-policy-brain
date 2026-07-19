import { describe, expect, it } from "vitest";
import { playNext, addToQueue, removeAt, moveTrack } from "@/lib/player/queue-ops";
import type { TrackRef } from "@/lib/repos/track";

const t = (id: string): TrackRef => ({
  source: "youtube",
  nativeId: id,
  title: `Track ${id}`,
  artist: "Someone",
  artUrl: null,
  durationSec: 200,
});

describe("queue-ops — pure array math for the visible queue (Wave 1)", () => {
  it("playNext puts the track at the front", () => {
    const q = [t("a"), t("b")];
    expect(playNext(q, t("z")).map((x) => x.nativeId)).toEqual(["z", "a", "b"]);
  });

  it("playNext de-dupes — an already-queued track moves to the front, never duplicates", () => {
    const q = [t("a"), t("b"), t("c")];
    expect(playNext(q, t("c")).map((x) => x.nativeId)).toEqual(["c", "a", "b"]);
  });

  it("addToQueue appends to the end", () => {
    const q = [t("a")];
    expect(addToQueue(q, t("b")).map((x) => x.nativeId)).toEqual(["a", "b"]);
  });

  it("addToQueue is a no-op for a track already queued (no stacked duplicate)", () => {
    const q = [t("a"), t("b")];
    expect(addToQueue(q, t("a")).map((x) => x.nativeId)).toEqual(["a", "b"]);
  });

  it("removeAt drops the indexed track; out-of-range is an honest no-op", () => {
    const q = [t("a"), t("b"), t("c")];
    expect(removeAt(q, 1).map((x) => x.nativeId)).toEqual(["a", "c"]);
    expect(removeAt(q, 9).map((x) => x.nativeId)).toEqual(["a", "b", "c"]);
    expect(removeAt(q, -1).map((x) => x.nativeId)).toEqual(["a", "b", "c"]);
  });

  it("moveTrack reorders from → to (a drag), clamping and no-opping identity", () => {
    const q = [t("a"), t("b"), t("c"), t("d")];
    expect(moveTrack(q, 0, 2).map((x) => x.nativeId)).toEqual(["b", "c", "a", "d"]);
    expect(moveTrack(q, 3, 0).map((x) => x.nativeId)).toEqual(["d", "a", "b", "c"]);
    // clamp beyond the end, and a no-op move returns the list unchanged.
    expect(moveTrack(q, 1, 99).map((x) => x.nativeId)).toEqual(["a", "c", "d", "b"]);
    expect(moveTrack(q, 2, 2).map((x) => x.nativeId)).toEqual(["a", "b", "c", "d"]);
  });

  it("never mutates the input array", () => {
    const q = [t("a"), t("b")];
    const snapshot = q.map((x) => x.nativeId);
    playNext(q, t("z"));
    addToQueue(q, t("z"));
    removeAt(q, 0);
    moveTrack(q, 0, 1);
    expect(q.map((x) => x.nativeId)).toEqual(snapshot);
  });
});
