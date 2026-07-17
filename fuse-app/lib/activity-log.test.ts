import { beforeEach, describe, expect, it } from "vitest";
import {
  clearActivity,
  getActivity,
  logActivity,
  logPlaybackError,
  onActivity,
  redactedLength,
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
