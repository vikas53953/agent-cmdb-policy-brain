import { describe, it, expect } from "vitest";
import {
  resultPlayability,
  SPOTIFY_SOON_REASON,
  ENGINE_SOON_REASON,
} from "./playability";

describe("resultPlayability — honesty rule (R17)", () => {
  it("Spotify results are ALWAYS disabled in this commit (playback lands U15)", () => {
    // Even if some adapter claimed to exist, Spotify stays honestly disabled.
    expect(resultPlayability("spotify", true)).toEqual({
      playable: false,
      reason: SPOTIFY_SOON_REASON,
    });
    expect(resultPlayability("spotify", false)).toEqual({
      playable: false,
      reason: SPOTIFY_SOON_REASON,
    });
  });

  it("YouTube is disabled with a reason until its adapter is registered (U7)", () => {
    expect(resultPlayability("youtube", false)).toEqual({
      playable: false,
      reason: ENGINE_SOON_REASON,
    });
  });

  it("YouTube becomes playable once its adapter is registered — no code change here", () => {
    expect(resultPlayability("youtube", true)).toEqual({ playable: true, reason: null });
  });

  it("local files never come from search", () => {
    const p = resultPlayability("local", true);
    expect(p.playable).toBe(false);
    expect(p.reason).toBeTruthy();
  });
});
