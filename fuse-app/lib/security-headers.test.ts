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

  it("allows the YouTube IFrame Player API script (script-src) — U7 needs it to drive the embed", () => {
    const csp = buildCsp(false);
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toContain("https://www.youtube.com");
    expect(scriptSrc).toContain("https://s.ytimg.com");
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

  it("allows the OAuth form redirect targets in form-action (else Chrome blocks sign-in)", () => {
    const csp = buildCsp(false);
    const formAction = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("form-action"));
    // Sign-in POSTs to /api/auth/... then 302s to Google; Chrome checks form-action
    // against the redirect target, so accounts.google.com MUST be allowed.
    expect(formAction).toContain("'self'");
    expect(formAction).toContain("https://accounts.google.com");
    expect(formAction).toContain("https://accounts.spotify.com");
  });

  it("does not weaken the other directives while widening form-action", () => {
    const csp = buildCsp(false);
    // form-action is widened to exactly two identity hosts and nothing more permissive.
    const formAction = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("form-action"));
    expect(formAction).toBe(
      "form-action 'self' https://accounts.google.com https://accounts.spotify.com",
    );
    // No wildcard or unsafe token crept into the policy as a whole.
    expect(csp).not.toContain("form-action *");
    expect(csp).not.toContain("default-src *");
    // The backbone that must stay strict is untouched.
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
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
