import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isNavPending,
  resetNavPending,
  setNavPending,
  subscribeNavPending,
} from "@/lib/ui/nav-pending";

afterEach(() => {
  resetNavPending();
});

describe("F-5 — the shell knows when a route change is in flight", () => {
  it("starts idle", () => {
    expect(isNavPending()).toBe(false);
  });

  it("goes pending when a link reports it, and clears when that link finishes", () => {
    setNavPending("/search", true);
    expect(isNavPending()).toBe(true);
    setNavPending("/search", false);
    expect(isNavPending()).toBe(false);
  });

  it("stays pending until the LAST in-flight link finishes", () => {
    setNavPending("/search", true);
    setNavPending("/dj", true);
    setNavPending("/search", false);
    expect(isNavPending()).toBe(true);
    setNavPending("/dj", false);
    expect(isNavPending()).toBe(false);
  });

  it("is idempotent, so a re-render reporting the same state cannot wedge it on", () => {
    setNavPending("/dj", true);
    setNavPending("/dj", true);
    setNavPending("/dj", false);
    expect(isNavPending()).toBe(false);
  });

  it("clearing a link that was never pending is harmless", () => {
    expect(() => setNavPending("/library", false)).not.toThrow();
    expect(isNavPending()).toBe(false);
  });
});

describe("F-5 — subscribers", () => {
  it("notifies on a real change", () => {
    const seen = vi.fn();
    subscribeNavPending(seen);
    setNavPending("/dj", true);
    expect(seen).toHaveBeenCalledTimes(1);
    setNavPending("/dj", false);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("does NOT wake subscribers when nothing actually changed", () => {
    const seen = vi.fn();
    subscribeNavPending(seen);
    setNavPending("/dj", true);
    seen.mockClear();
    setNavPending("/dj", true); // same state again — must be silent
    expect(seen).not.toHaveBeenCalled();
  });

  it("unsubscribing really stops notifications", () => {
    const seen = vi.fn();
    const off = subscribeNavPending(seen);
    off();
    setNavPending("/dj", true);
    expect(seen).not.toHaveBeenCalled();
  });

  it("notifies every subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeNavPending(a);
    subscribeNavPending(b);
    setNavPending("/", true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
