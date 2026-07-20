import { describe, it, expect } from "vitest";
import { buildSessions, coPlayAffinity, SESSION_GAP_MS, type PlayEvent } from "./coplay";

const T0 = new Date("2026-01-01T12:00:00Z").getTime();

function play(ownerId: string, nativeId: string, minutesFromStart: number): PlayEvent {
  return {
    ownerId,
    source: "youtube",
    nativeId,
    playedAt: new Date(T0 + minutesFromStart * 60_000),
  };
}

describe("coplay — building listening sessions", () => {
  it("groups plays that follow each other closely into one session", () => {
    const events = [play("u1", "a", 0), play("u1", "b", 3), play("u1", "c", 7)];
    expect(buildSessions(events)).toEqual([["youtube:a", "youtube:b", "youtube:c"]]);
  });

  it("starts a new session after a long gap", () => {
    const gapMinutes = SESSION_GAP_MS / 60_000;
    const events = [play("u1", "a", 0), play("u1", "b", gapMinutes + 5)];
    expect(buildSessions(events)).toEqual([["youtube:a"], ["youtube:b"]]);
  });

  it("never mixes two people's listening into one session", () => {
    const events = [play("u1", "a", 0), play("u2", "b", 1)];
    const sessions = buildSessions(events);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.join(","))).toEqual(
      expect.arrayContaining(["youtube:a", "youtube:b"]),
    );
  });

  it("counts a song on repeat only once, so looping cannot inflate it", () => {
    const events = [play("u1", "a", 0), play("u1", "a", 4), play("u1", "b", 8)];
    expect(buildSessions(events)).toEqual([["youtube:a", "youtube:b"]]);
  });

  it("orders each session by time even when rows arrive newest-first", () => {
    const events = [play("u1", "c", 7), play("u1", "a", 0), play("u1", "b", 3)];
    expect(buildSessions(events)).toEqual([["youtube:a", "youtube:b", "youtube:c"]]);
  });
});

describe("coplay — affinity scores", () => {
  it("credits songs heard in the same sitting as one the user loves", () => {
    const events = [
      // Two people both played the loved track next to "b".
      play("u1", "loved", 0),
      play("u1", "b", 3),
      play("u2", "loved", 0),
      play("u2", "b", 2),
      play("u2", "c", 5),
    ];
    const scores = coPlayAffinity(events, ["youtube:loved"]);
    expect(scores.get("youtube:b")).toBe(2);
    expect(scores.get("youtube:c")).toBe(1);
  });

  it("ignores sessions that contain nothing the user loves", () => {
    const events = [play("u1", "x", 0), play("u1", "y", 2)];
    expect(coPlayAffinity(events, ["youtube:loved"]).size).toBe(0);
  });

  it("never scores a track the user already has", () => {
    const events = [play("u1", "loved", 0), play("u1", "b", 2)];
    const scores = coPlayAffinity(events, ["youtube:loved", "youtube:b"]);
    expect(scores.size).toBe(0);
  });

  it("returns nothing for a brand-new account with no taste yet", () => {
    const events = [play("u1", "a", 0), play("u1", "b", 2)];
    expect(coPlayAffinity(events, []).size).toBe(0);
  });
});
