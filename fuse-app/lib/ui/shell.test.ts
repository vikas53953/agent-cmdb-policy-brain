import { describe, expect, it } from "vitest";
import {
  TABS,
  isActiveTab,
  showsMiniPlayer,
  PENDING_CONTROLS,
  SOURCE_BADGES,
} from "@/lib/ui/shell";

describe("shell tabs", () => {
  it("declares the four prototype tabs in order", () => {
    expect(TABS.map((t) => t.label)).toEqual(["Home", "Search", "DJ", "Library"]);
    expect(TABS.map((t) => t.href)).toEqual(["/", "/search", "/dj", "/library"]);
  });

  it("marks Home active only on the exact root path", () => {
    expect(isActiveTab("/", "/")).toBe(true);
    expect(isActiveTab("/search", "/")).toBe(false);
    expect(isActiveTab("/library", "/")).toBe(false);
  });

  it("marks a non-home tab active on its route and nested routes", () => {
    expect(isActiveTab("/library", "/library")).toBe(true);
    expect(isActiveTab("/library/playlists/42", "/library")).toBe(true);
    expect(isActiveTab("/search", "/library")).toBe(false);
  });
});

describe("mini-player visibility (R4)", () => {
  it("shows on Home, Search, and Library", () => {
    expect(showsMiniPlayer("/")).toBe(true);
    expect(showsMiniPlayer("/search")).toBe(true);
    expect(showsMiniPlayer("/library")).toBe(true);
  });

  it("hides on the DJ console and its nested routes", () => {
    expect(showsMiniPlayer("/dj")).toBe(false);
    expect(showsMiniPlayer("/dj/session")).toBe(false);
  });
});

describe("pending controls honesty (R17)", () => {
  it("every not-yet-wired control carries a plain-English reason and an owning unit", () => {
    expect(PENDING_CONTROLS.length).toBeGreaterThan(0);
    for (const control of PENDING_CONTROLS) {
      expect(control.label.trim().length).toBeGreaterThan(0);
      expect(control.reason.trim().length).toBeGreaterThan(0);
      expect(control.wiredIn).toMatch(/^U\d+$/);
    }
  });

  it("does not list a dropped-from-v1 audio-quality control (R16)", () => {
    const ids = PENDING_CONTROLS.map((c) => c.id.toLowerCase());
    expect(ids.some((id) => id.includes("quality"))).toBe(false);
  });
});

describe("source badges", () => {
  it("maps each of the three sources to a badge class and label", () => {
    expect(SOURCE_BADGES.youtube).toEqual({ className: "yt", label: "YouTube" });
    expect(SOURCE_BADGES.spotify).toEqual({ className: "sp", label: "Spotify" });
    expect(SOURCE_BADGES.local).toEqual({ className: "mp3", label: "My Files" });
  });
});
