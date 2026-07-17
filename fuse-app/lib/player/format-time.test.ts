import { describe, expect, it } from "vitest";
import { formatTime } from "@/lib/player/format-time";

describe("formatTime (scrub / Now Playing readout)", () => {
  it("formats seconds as m:ss with a zero-padded seconds field", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(200)).toBe("3:20");
  });

  it("adds an hours field past an hour", () => {
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3661)).toBe("1:01:01");
  });

  it("floors fractional seconds", () => {
    expect(formatTime(65.9)).toBe("1:05");
  });

  it("guards unknown / invalid durations to 0:00", () => {
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(-10)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
  });
});
