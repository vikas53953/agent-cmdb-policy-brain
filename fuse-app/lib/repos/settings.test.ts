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
  getPreferAudio,
  setPreferAudio,
  CROSSFADE_DEFAULT_SEC,
  CROSSFADE_MIN_SEC,
  CROSSFADE_MAX_SEC,
  VOLUME_DEFAULT,
  decodeSettings,
  getResolvedSettings,
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

describe("prefer-audio setting (Complaint 1)", () => {
  it("defaults ON and round-trips a toggle", async () => {
    const { prisma } = db();
    expect(await getPreferAudio("A", prisma)).toBe(true);
    await setPreferAudio("A", false, prisma);
    expect(await getPreferAudio("A", prisma)).toBe(false);
    await setPreferAudio("A", true, prisma);
    expect(await getPreferAudio("A", prisma)).toBe(true);
  });

  it("is scoped per user", async () => {
    const { prisma } = db();
    await setPreferAudio("A", false, prisma);
    expect(await getPreferAudio("A", prisma)).toBe(false);
    expect(await getPreferAudio("B", prisma)).toBe(true); // B keeps the default
  });
});

describe("settings repo — the shell reads every setting in ONE query (B)", () => {
  it("getResolvedSettings issues a single findMany, not one findUnique per setting", async () => {
    const setting = makeModel([
      { ownerId: "A", key: "crossfadeSec", value: "9" },
      { ownerId: "A", key: "lyricsEnabled", value: "false" },
      { ownerId: "A", key: "volume", value: "0.5" },
    ]);
    const prisma = makePrisma({ setting: setting.model });

    const resolved = await getResolvedSettings("A", prisma);

    // The bug: five serial findUnique round-trips gated every page render.
    expect(setting.calls.findUnique.length).toBe(0);
    expect(setting.calls.findMany.length).toBe(1);
    expect(resolved.crossfadeSec).toBe(9);
    expect(resolved.lyricsEnabled).toBe(false);
    expect(resolved.volume).toBe(0.5);
    // Unset keys still fall back to the same honest defaults as the single accessors.
    expect(resolved.preferAudio).toBe(true);
    expect(resolved.autoplaySimilar).toBe(true);
  });

  it("decodeSettings clamps and defaults identically to the per-setting accessors", () => {
    expect(decodeSettings({}).crossfadeSec).toBe(CROSSFADE_DEFAULT_SEC);
    expect(decodeSettings({ crossfadeSec: "99" }).crossfadeSec).toBe(CROSSFADE_MAX_SEC);
    expect(decodeSettings({ crossfadeSec: "1" }).crossfadeSec).toBe(CROSSFADE_MIN_SEC);
    expect(decodeSettings({ crossfadeSec: "junk" }).crossfadeSec).toBe(CROSSFADE_DEFAULT_SEC);
    expect(decodeSettings({ volume: "5" }).volume).toBe(1);
    expect(decodeSettings({ volume: "-2" }).volume).toBe(0);
    expect(decodeSettings({}).volume).toBe(VOLUME_DEFAULT);
  });
});
