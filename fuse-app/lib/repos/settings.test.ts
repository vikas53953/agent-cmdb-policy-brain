import { describe, it, expect } from "vitest";
import { makeModel, makePrisma } from "./__fixtures__/fake-prisma";
import {
  getSetting,
  setSetting,
  getAllSettings,
  getCrossfadeSec,
  setCrossfadeSec,
  getLyricsEnabled,
  setLyricsEnabled,
  CROSSFADE_DEFAULT_SEC,
  CROSSFADE_MIN_SEC,
  CROSSFADE_MAX_SEC,
} from "./settings";

function db() {
  const setting = makeModel();
  return { prisma: makePrisma({ setting: setting.model }), setting };
}

describe("settings repo isolation", () => {
  it("a setting written by A is not visible to B", async () => {
    const { prisma } = db();
    await setSetting("A", "crossfadeSec", "8", prisma);
    expect(await getSetting("A", "crossfadeSec", prisma)).toBe("8");
    expect(await getSetting("B", "crossfadeSec", prisma)).toBeNull();
  });

  it("getAllSettings returns only the caller's rows", async () => {
    const { prisma } = db();
    await setSetting("A", "lyricsEnabled", "false", prisma);
    await setSetting("B", "lyricsEnabled", "true", prisma);
    expect(await getAllSettings("A", prisma)).toEqual({ lyricsEnabled: "false" });
  });
});

describe("crossfade setting (R11)", () => {
  it("defaults when unset and clamps out-of-range writes", async () => {
    const { prisma } = db();
    expect(await getCrossfadeSec("A", prisma)).toBe(CROSSFADE_DEFAULT_SEC);

    await setCrossfadeSec("A", 999, prisma);
    expect(await getCrossfadeSec("A", prisma)).toBe(CROSSFADE_MAX_SEC);

    await setCrossfadeSec("A", 1, prisma);
    expect(await getCrossfadeSec("A", prisma)).toBe(CROSSFADE_MIN_SEC);

    await setCrossfadeSec("A", 8, prisma);
    expect(await getCrossfadeSec("A", prisma)).toBe(8);
  });

  it("falls back to default on a corrupt stored value", async () => {
    const { prisma } = db();
    await setSetting("A", "crossfadeSec", "not-a-number", prisma);
    expect(await getCrossfadeSec("A", prisma)).toBe(CROSSFADE_DEFAULT_SEC);
  });
});

describe("lyrics on/off setting (R16)", () => {
  it("defaults on, round-trips a toggle", async () => {
    const { prisma } = db();
    expect(await getLyricsEnabled("A", prisma)).toBe(true);
    await setLyricsEnabled("A", false, prisma);
    expect(await getLyricsEnabled("A", prisma)).toBe(false);
    await setLyricsEnabled("A", true, prisma);
    expect(await getLyricsEnabled("A", prisma)).toBe(true);
  });
});
