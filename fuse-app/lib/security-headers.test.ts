import { describe, expect, it } from "vitest";
import { buildCsp, securityHeaders } from "./security-headers";

describe("buildCsp (KTD-9 minimal deny-all relaxation)", () => {
  it("allows the YouTube player iframe (frame-src)", () => {
    const csp = buildCsp(false);
    const frameSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("frame-src"));
    expect(frameSrc).toContain("https://www.youtube.com");
  });

  it("allows YouTube thumbnails from i.ytimg.com (img-src)", () => {
    const csp = buildCsp(false);
    const imgSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("img-src"));
    expect(imgSrc).toContain("https://i.ytimg.com");
  });

  it("allows the Spotify Web Playback SDK script and API connections", () => {
    const csp = buildCsp(false);
    expect(csp).toContain("https://sdk.scdn.co");
    expect(csp).toContain("https://api.spotify.com");
  });

  it("allows local files to play as blob URLs but never upload elsewhere (media-src)", () => {
    const csp = buildCsp(false);
    const mediaSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("media-src"));
    expect(mediaSrc).toBe("media-src 'self' blob:");
  });

  it("keeps the deny-all backbone: no plugins, locked base-uri, un-frameable", () => {
    const csp = buildCsp(false);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("only adds 'unsafe-eval' in development", () => {
    expect(buildCsp(true)).toContain("'unsafe-eval'");
    expect(buildCsp(false)).not.toContain("'unsafe-eval'");
  });
});

describe("securityHeaders", () => {
  it("includes HSTS, nosniff, frame-options, and the CSP", () => {
    const keys = securityHeaders(false).map((h) => h.key);
    expect(keys).toContain("Strict-Transport-Security");
    expect(keys).toContain("X-Content-Type-Options");
    expect(keys).toContain("X-Frame-Options");
    expect(keys).toContain("Content-Security-Policy");
  });
});
