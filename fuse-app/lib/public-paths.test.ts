import { describe, expect, it } from "vitest";
import { isPublicPath, PUBLIC_EXACT } from "./public-paths";

// The proxy's public-route policy is tested against its pure module so the test never
// imports the proxy (which pulls in next-auth / next/server and cannot load in node).
describe("isPublicPath (proxy fail-closed policy)", () => {
  it("keeps the Auth.js endpoints public (else the sign-in redirect loops)", () => {
    expect(isPublicPath("/api/auth")).toBe(true);
    expect(isPublicPath("/api/auth/signin")).toBe(true);
    expect(isPublicPath("/api/auth/callback/google")).toBe(true);
  });

  it("makes the branded /login screen public so signed-out visitors can reach it", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(PUBLIC_EXACT).toContain("/login");
  });

  it("matches /login exactly — no nested or look-alike path leaks through", () => {
    expect(isPublicPath("/login/extra")).toBe(false);
    expect(isPublicPath("/login-secret")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
  });

  it("fails closed: every real app route requires auth", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/search")).toBe(false);
    expect(isPublicPath("/library")).toBe(false);
    expect(isPublicPath("/dj")).toBe(false);
    expect(isPublicPath("/api/search")).toBe(false);
    // A look-alike that a naive startsWith("/api/auth") would have wrongly allowed.
    expect(isPublicPath("/api/authorize")).toBe(false);
  });
});
