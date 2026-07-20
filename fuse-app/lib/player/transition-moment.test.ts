import { describe, expect, it } from "vitest";
import { computeTransitionView, type TransitionInput } from "@/lib/player/transition-moment";
import type { TrackRef } from "@/lib/repos/track";

// F-0 item 1: the Transition Moment states the TRUTH about what happens next — the next
// track, a live fuse countdown, and an energy/BPM line ONLY when genuinely computed. When
// nothing is next it says playback will end. These pin every honest branch.

const track = (id: string, title = `Track ${id}`, durationSec = 200): TrackRef => ({
  source: "youtube",
  nativeId: id,
  title,
  artist: "Someone",
  artUrl: null,
  durationSec,
});

const base: TransitionInput = {
  current: track("one"),
  next: track("two"),
  positionSec: 100,
  durationSec: 200,
  crossfadeSec: 6,
  canFuse: true,
  meltActive: false,
  maxCrossfadeSec: 6,
};

describe("computeTransitionView — honest next / countdown / ending", () => {
  it("says playback will END when there is no next track", () => {
    expect(computeTransitionView({ ...base, next: null })).toEqual({ kind: "ending" });
    expect(computeTransitionView({ ...base, current: null })).toEqual({ kind: "ending" });
  });

  it("shows an honest UP-NEXT (no invented countdown) when the pair cannot truly fuse", () => {
    const view = computeTransitionView({ ...base, canFuse: false });
    expect(view.kind).toBe("up-next");
    if (view.kind === "up-next") expect(view.next.nativeId).toBe("two");
  });

  it("shows UP-NEXT when the current duration is not known yet (cannot count down honestly)", () => {
    const view = computeTransitionView({ ...base, durationSec: 0 });
    expect(view.kind).toBe("up-next");
  });

  it("counts down to the fuse: seconds = (duration - crossfade) - position", () => {
    // duration 200, crossfade 6 → fuse starts at 194. At position 100 → 94s to go.
    const view = computeTransitionView({ ...base, positionSec: 100 });
    expect(view.kind).toBe("fusing");
    if (view.kind === "fusing") {
      expect(view.secondsUntilFuse).toBe(94);
      expect(view.inWindow).toBe(false);
      expect(view.crossfadeSec).toBe(6);
    }
  });

  it("reports inWindow (fusing now, 0s left) once position enters the tail or a melt runs", () => {
    const inTail = computeTransitionView({ ...base, positionSec: 197 });
    expect(inTail.kind).toBe("fusing");
    if (inTail.kind === "fusing") {
      expect(inTail.inWindow).toBe(true);
      expect(inTail.secondsUntilFuse).toBe(0);
    }
    const melting = computeTransitionView({ ...base, positionSec: 50, meltActive: true });
    if (melting.kind === "fusing") expect(melting.inWindow).toBe(true);
  });

  it("gives a duration/title-based hint but NEVER a BPM line for a YouTube pair (no analysis)", () => {
    const view = computeTransitionView(base);
    if (view.kind === "fusing") {
      expect(view.hint).toMatch(/melt/i);
      expect(view.energyLine).toBeNull(); // no analysis → no invented energy/BPM
    }
  });

  it("shows the energy/BPM line ONLY when BOTH tracks carry real computed analysis", () => {
    // Only one side analyzed → still null (never half-invented).
    const oneSide = computeTransitionView({ ...base, currentAnalysis: { bpm: 120 } });
    if (oneSide.kind === "fusing") expect(oneSide.energyLine).toBeNull();

    // Both analyzed and close → an honest "matched" flow line.
    const matched = computeTransitionView({
      ...base,
      currentAnalysis: { bpm: 120 },
      nextAnalysis: { bpm: 122 },
    });
    if (matched.kind === "fusing") {
      expect(matched.energyLine).toBe("Energy: matched · 122 BPM flow");
    }

    // Both analyzed but far apart → an honest transition line, not a false "matched".
    const shift = computeTransitionView({
      ...base,
      currentAnalysis: { bpm: 90 },
      nextAnalysis: { bpm: 140 },
    });
    if (shift.kind === "fusing") {
      expect(shift.energyLine).toBe("Energy: 90 → 140 BPM");
    }
  });
});
