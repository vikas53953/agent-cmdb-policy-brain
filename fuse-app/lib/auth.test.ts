import { describe, it, expect } from "vitest";
import { signInGate } from "./auth-policy";

// The sign-in policy is tested against its pure module (lib/auth-policy.ts) so the
// test never imports next-auth (which drags in `next/server` and cannot load in the
// node test environment). lib/auth.ts uses this exact function in its signIn callback.
describe("signInGate (public sign-in policy, fail closed)", () => {
  it("allows a Google account with a verified email", () => {
    expect(signInGate("google", true)).toBe(true);
  });

  it("rejects a Google account whose email is not verified", () => {
    expect(signInGate("google", false)).toBe(false);
    expect(signInGate("google", undefined)).toBe(false);
    expect(signInGate("google", "true")).toBe(false); // must be the boolean true, not truthy
  });

  it("rejects any non-Google provider (no others are configured)", () => {
    expect(signInGate("github", true)).toBe(false);
    expect(signInGate(undefined, true)).toBe(false);
  });
});
