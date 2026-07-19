import { describe, expect, it } from "vitest";
import { fingerprintBytes, localTrackKey } from "@/lib/dj/fingerprint";

function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}

describe("fingerprintBytes", () => {
  it("is stable — the same bytes always hash to the same 8-char hex id", () => {
    const a = bytes(1, 2, 3, 4, 5, 6, 7, 8);
    expect(fingerprintBytes(a)).toBe(fingerprintBytes(bytes(1, 2, 3, 4, 5, 6, 7, 8)));
    expect(fingerprintBytes(a)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when the content changes", () => {
    expect(fingerprintBytes(bytes(1, 2, 3, 4))).not.toBe(fingerprintBytes(bytes(1, 2, 3, 5)));
  });

  it("distinguishes files of different length even with a shared prefix", () => {
    expect(fingerprintBytes(bytes(1, 2, 3))).not.toBe(fingerprintBytes(bytes(1, 2, 3, 0)));
  });

  it("catches a change at the very tail of a large buffer", () => {
    const big = new Uint8Array(200_000);
    const same = new Uint8Array(200_000);
    same[199_999] = 7; // only the last byte differs
    expect(fingerprintBytes(big)).not.toBe(fingerprintBytes(same));
  });

  it("handles empty input without throwing", () => {
    expect(fingerprintBytes(bytes())).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("localTrackKey", () => {
  it("combines content and name into a stable, well-formed key", () => {
    const b = bytes(10, 20, 30, 40);
    const key = localTrackKey(b, "midnight-drive.mp3");
    expect(key).toBe(localTrackKey(bytes(10, 20, 30, 40), "midnight-drive.mp3"));
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/);
  });

  it("gives the same content a different key under a different name", () => {
    const b = bytes(10, 20, 30, 40);
    expect(localTrackKey(b, "a.mp3")).not.toBe(localTrackKey(b, "b.mp3"));
  });
});
