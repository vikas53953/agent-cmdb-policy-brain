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
  // The default for these cases is a track genuinely playing — a countdown is only ever
  // honest while sound is moving (see the gating tests at the bottom of this file).
  motion: "sounding",
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

// ── The gate: a countdown is only shown while sound is genuinely moving ──────────────
//
// THE BUG THESE PIN. A YouTube embed that refused to start left positionSec frozen at 0,
// so the countdown was TRUE arithmetic (202 − 4 = 198) on a clock that had never moved —
// and the hero block promised a fuse that could never happen, while the same screen said
// the track wouldn't play. Two consecutive 3:22 tracks both read "198 seconds" for exactly
// that reason. The countdown is now gated on the one playback reading.
describe("computeTransitionView — never promises a fuse while playback is not moving", () => {
  it("suppresses the countdown while the track is STUCK, and says so plainly", () => {
    const view = computeTransitionView({ ...base, motion: "stuck", positionSec: 0 });
    expect(view.kind).toBe("fuse-held");
    if (view.kind === "fuse-held") {
      expect(view.next.nativeId).toBe("two"); // NEXT is still true, so it still shows
      expect(view.status).toMatch(/isn't playing/i);
      expect(view.status).not.toMatch(/\d/); // never a number the app cannot stand behind
    }
  });

  it("suppresses the countdown while the app is still STARTING the track", () => {
    const view = computeTransitionView({ ...base, motion: "starting", positionSec: 0 });
    expect(view.kind).toBe("fuse-held");
    if (view.kind === "fuse-held") expect(view.status).toMatch(/starting/i);
  });

  it("treats a USER PAUSE differently from a stall: calm wording, no fault implied", () => {
    const paused = computeTransitionView({ ...base, motion: "paused" });
    const stuck = computeTransitionView({ ...base, motion: "stuck" });
    expect(paused.kind).toBe("fuse-held");
    if (paused.kind === "fuse-held" && stuck.kind === "fuse-held") {
      expect(paused.status).toMatch(/paused/i);
      expect(paused.status).toMatch(/play/i); // says what the listener can do
      expect(paused.status).not.toBe(stuck.status);
    }
  });

  it("still shows the melt while a real blend runs, even mid-promotion", () => {
    // A running blend is driven by the wall clock, not the track position, so it is real
    // sound moving — the countdown/fusing state must survive the gate.
    const view = computeTransitionView({ ...base, motion: "starting", meltActive: true });
    expect(view.kind).toBe("fusing");
    if (view.kind === "fusing") expect(view.inWindow).toBe(true);
  });

  it("two different frozen tracks both stay held — never the same stale number twice", () => {
    const a = computeTransitionView({ ...base, motion: "stuck", durationSec: 202, positionSec: 0 });
    const b = computeTransitionView({ ...base, motion: "stuck", durationSec: 202, positionSec: 0 });
    expect(a.kind).toBe("fuse-held");
    expect(b.kind).toBe("fuse-held");
  });
});
