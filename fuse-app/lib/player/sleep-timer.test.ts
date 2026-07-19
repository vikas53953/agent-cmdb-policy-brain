import { describe, expect, it, vi } from "vitest";
import { SleepTimer, type SleepTimerPorts } from "@/lib/player/sleep-timer";

// A controllable fake clock + interval so we drive time deterministically.
function harness(overrides: Partial<SleepTimerPorts> = {}) {
  let nowMs = 0;
  const ticks: Array<() => void> = [];
  const fired: string[] = [];
  const stopFlag: boolean[] = [];
  const ports: SleepTimerPorts = {
    onFire: () => fired.push("fire"),
    setStopAfterTrack: (stop) => stopFlag.push(stop ? true : false),
    now: () => nowMs,
    setInterval: (h) => {
      ticks.push(h);
      return ticks.length;
    },
    clearInterval: () => {},
    ...overrides,
  };
  const timer = new SleepTimer(ports);
  return {
    timer,
    fired,
    stopFlag,
    advance(ms: number) {
      nowMs += ms;
      for (const t of ticks) t();
    },
  };
}

describe("SleepTimer — stop after minutes (Wave 1)", () => {
  it("counts down and pauses playback when the minutes elapse", () => {
    const h = harness();
    h.timer.armMinutes(15);
    expect(h.timer.getState()).toMatchObject({ mode: "minutes", minutes: 15, remainingSec: 900 });

    h.advance(60_000); // one minute in
    expect(h.timer.getState().remainingSec).toBe(840);
    expect(h.fired).toHaveLength(0);

    h.advance(14 * 60_000); // reach 15 minutes
    expect(h.fired).toEqual(["fire"]); // real pause
    expect(h.timer.getState().mode).toBe("off"); // disarmed after firing
  });

  it("cancel stops the countdown before it fires", () => {
    const h = harness();
    h.timer.armMinutes(30);
    h.advance(60_000);
    h.timer.cancel();
    expect(h.timer.getState().mode).toBe("off");
    h.advance(60 * 60_000);
    expect(h.fired).toHaveLength(0); // cancelled — never fired
  });

  it("re-arming replaces the prior timer (only one runs)", () => {
    const h = harness();
    h.timer.armMinutes(15);
    h.timer.armMinutes(45);
    expect(h.timer.getState().minutes).toBe(45);
  });
});

describe("SleepTimer — stop at end of track (Wave 1)", () => {
  it("arms the player flag and shows no fake countdown", () => {
    const h = harness();
    h.timer.armEndOfTrack();
    expect(h.timer.getState()).toMatchObject({ mode: "end-of-track", remainingSec: 0 });
    expect(h.stopFlag).toEqual([true]); // player told to stop after the track
  });

  it("cancel clears the player flag so the track will NOT stop", () => {
    const h = harness();
    h.timer.armEndOfTrack();
    h.timer.cancel();
    expect(h.stopFlag).toEqual([true, false]);
    expect(h.timer.getState().mode).toBe("off");
  });

  it("notifyTrackEnded clears the chip once the stop has been honoured", () => {
    const h = harness();
    h.timer.armEndOfTrack();
    h.timer.notifyTrackEnded();
    expect(h.timer.getState().mode).toBe("off");
  });

  it("notifies subscribers on arm and cancel", () => {
    const h = harness();
    const seen = vi.fn();
    h.timer.subscribe(seen);
    h.timer.armMinutes(15);
    h.timer.cancel();
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
