import { describe, expect, it } from "vitest";
import { dedupeTracks } from "@/lib/home/recommend";
import type { TrackRef } from "@/lib/repos/track";

// Owner fix 6: recently-played must show a track ONCE, at its most-recent position, like every
// big app. The Home feed reads plays newest-first and de-duplicates, keeping the FIRST (=most
// recent) occurrence. This pins that guarantee on the exact shape the feed uses.

const play = (id: string): TrackRef => ({
  source: "youtube",
  nativeId: id,
  title: `Track ${id}`,
  artist: "Someone",
  artUrl: null,
  durationSec: 200,
});

describe("recently-played de-duplication (owner fix 6)", () => {
  it("collapses a track played twice to one row at its most-recent position", () => {
    // Newest-first history: A (now), B, A (earlier), C.
    const newestFirst = [play("A"), play("B"), play("A"), play("C")];
    const deduped = dedupeTracks([newestFirst]);
    expect(deduped.map((t) => t.nativeId)).toEqual(["A", "B", "C"]);
    // Exactly one A, and it sits at the most-recent (front) position.
    expect(deduped.filter((t) => t.nativeId === "A")).toHaveLength(1);
    expect(deduped[0].nativeId).toBe("A");
  });
});
