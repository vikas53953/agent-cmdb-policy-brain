import { beforeEach, describe, expect, it } from "vitest";
import {
  clearActivity,
  formatActivityLine,
  formatActivitySummary,
  getActivity,
  logActivity,
  logPlaybackError,
  onActivity,
  redactedLength,
  summarizeActivity,
  type ActivityEvent,
} from "@/lib/activity-log";

beforeEach(() => {
  clearActivity();
});

describe("activity log records playback events (R18)", () => {
  it("stores an event and returns it, readable oldest-first", () => {
    logActivity({ level: "info", type: "play", message: 'Now playing "Track A"' });
    logPlaybackError("This video is unavailable", { code: 100 });

    const events = getActivity();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("play");
    expect(events[1].level).toBe("error");
    expect(events[1].message).toBe("This video is unavailable");
    expect(events[1].detail).toEqual({ code: 100 });
  });

  it("notifies subscribers as events land, and stops after unsubscribe", () => {
    const seen: ActivityEvent[] = [];
    const off = onActivity((e) => seen.push(e));
    logActivity({ level: "info", type: "stall-retry", message: "Playback stalled — retrying" });
    expect(seen).toHaveLength(1);
    off();
    logActivity({ level: "info", type: "play", message: "again" });
    expect(seen).toHaveLength(1);
  });

  it("stays bounded — never grows past the cap", () => {
    for (let i = 0; i < 250; i += 1) {
      logActivity({ level: "info", type: "tick", message: `event ${i}` });
    }
    const events = getActivity();
    expect(events.length).toBeLessThanOrEqual(200);
    // Oldest fell off the front; the newest is retained.
    expect(events.at(-1)?.message).toBe("event 249");
  });
});

describe("secrets never touch the log (owner standing rule)", () => {
  it("redactedLength records a length, never the value", () => {
    const secret = "super-secret-token-value";
    const marker = redactedLength(secret);
    expect(marker).toEqual({ redacted: true, length: secret.length });

    logPlaybackError("Auth failed while connecting a source", { token: redactedLength(secret) });
    const detail = getActivity().at(-1)?.detail ?? {};
    // The raw secret appears nowhere in the serialized log entry.
    expect(JSON.stringify(detail)).not.toContain(secret);
    expect(detail.token).toEqual({ redacted: true, length: secret.length });
  });

  it("treats a null/undefined sensitive value as length 0", () => {
    expect(redactedLength(null)).toEqual({ redacted: true, length: 0 });
    expect(redactedLength(undefined)).toEqual({ redacted: true, length: 0 });
  });
});

describe("diagnostics readers (U16, R18)", () => {
  const at = new Date(2026, 6, 18, 9, 5, 3).getTime(); // 09:05:03 local

  it("formats a readable, secret-safe line for a plain event", () => {
    const line = formatActivityLine({
      at,
      level: "info",
      type: "play",
      message: 'Now playing "Track A"',
      detail: { code: 100 },
    });
    expect(line).toBe('09:05:03  info  play  Now playing "Track A"  (code=100)');
  });

  it("renders a redacted value as its length only — never the value", () => {
    const secret = "super-secret-token-value";
    const line = formatActivityLine({
      at,
      level: "error",
      type: "error",
      message: "Auth failed",
      detail: { token: redactedLength(secret) },
    });
    expect(line).toContain("ERROR");
    expect(line).toContain(`token=[${secret.length} chars]`);
    expect(line).not.toContain(secret);
  });

  it("degrades a bad timestamp to a placeholder instead of throwing", () => {
    const line = formatActivityLine({
      at: Number.NaN,
      level: "info",
      type: "tick",
      message: "x",
    });
    expect(line.startsWith("--:--:--")).toBe(true);
  });

  it("summarizes totals, error counts, and stall counts", () => {
    logActivity({ level: "info", type: "play", message: "a" });
    logPlaybackError("b");
    logActivity({ level: "info", type: "play", message: "c" });
    expect(summarizeActivity()).toEqual({ total: 3, errors: 1, stalls: 0 });
    expect(summarizeActivity([])).toEqual({ total: 0, errors: 0, stalls: 0 });
  });

  // ── Diagnostics-truth fix: failures the user can see must be countable, and stalls
  //    the user felt must never be hidden behind "0 errors, nothing wrong". ──────────────
  it("counts recovery attempts as stalls (info level), kept apart from hard errors", () => {
    logActivity({ level: "info", type: "play", message: "playing" });
    logActivity({ level: "info", type: "stall-retry", message: "Playback stalled — retrying" });
    logActivity({
      level: "info",
      type: "stall-recreate",
      message: "Playback stalled — rebuilding the player",
    });
    // Two hitches, both logged at info level, but neither ended in a hard failure.
    expect(summarizeActivity()).toEqual({ total: 3, errors: 0, stalls: 2 });
  });

  it("a recovered-stall run is never misreported as '0 errors, nothing wrong'", () => {
    logActivity({ level: "info", type: "play", message: "playing" });
    logActivity({ level: "info", type: "stall-retry", message: "Playback stalled — retrying" });
    const summary = summarizeActivity();
    expect(summary.errors).toBe(0);
    expect(summary.stalls).toBe(1);
    // The header line MUST show the stall — a listener who felt the hitch is not told
    // everything was clean. And it reads in plain words, no dev jargon.
    const line = formatActivitySummary(summary);
    expect(line).toContain("1 stall");
    expect(line).toContain("recovered");
    expect(line).not.toMatch(/exception|fault/i);
  });

  it("formats the summary line in plain words for errors, stalls, and the empty log", () => {
    expect(formatActivitySummary({ total: 0, errors: 0, stalls: 0 })).toBe(
      "No activity recorded yet.",
    );
    expect(formatActivitySummary({ total: 5, errors: 0, stalls: 0 })).toBe("5 events, 0 errors");
    expect(formatActivitySummary({ total: 4, errors: 1, stalls: 0 })).toBe("4 events, 1 error");
    // Stalls that ended in a real error are shown, but NOT called "recovered".
    expect(formatActivitySummary({ total: 6, errors: 1, stalls: 3 })).toBe(
      "6 events, 1 error, 3 stalls",
    );
    // Stalls with no hard error are honestly labelled recovered.
    expect(formatActivitySummary({ total: 6, errors: 0, stalls: 3 })).toBe(
      "6 events, 0 errors, 3 stalls, recovered",
    );
  });
});
