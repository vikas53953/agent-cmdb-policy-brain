// Per-user settings repository (R16). Settings are stored as key/value string rows
// (one row per (owner, key), composite PK) so a new setting needs no migration —
// each owning unit reads/writes its own key. Every function is scoped to a `userId`;
// a user can only ever read or write their own settings.
//
// Only two settings survive v1 as real controls and are given typed accessors here:
//   - crossfade length in seconds (wired by U11's slider + read by the blend engine)
//   - lyrics on/off (wired by U9's toggle + read by the lyrics panel)
// Connected-sources state (U15) uses the generic get/set. Audio-quality was dropped
// from v1 (R16), so there is deliberately no accessor for it — no dead setting.

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

export const SETTING_KEYS = {
  crossfadeSec: "crossfadeSec",
  lyricsEnabled: "lyricsEnabled",
  preferAudio: "preferAudio",
  autoplaySimilar: "autoplaySimilar",
  volume: "volume",
} as const;

// Output volume is a 0..1 level (owner fix 3). Default full so a first-time listener hears
// sound at the level the video itself carries; the store applies it to the YouTube adapter.
export const VOLUME_DEFAULT = 1;

// Crossfade length is user-chosen within 3..15s (R3/R11). Clamp on write so a bad
// value can never persist, and default to 6s when unset.
export const CROSSFADE_MIN_SEC = 3;
export const CROSSFADE_MAX_SEC = 15;
export const CROSSFADE_DEFAULT_SEC = 6;

// Generic read of one setting for the caller. Returns null when unset. Scoped to
// ownerId via the composite PK, so no cross-user read is possible.
export async function getSetting(
  userId: string,
  key: string,
  db: PrismaClient = prisma,
): Promise<string | null> {
  const row = await db.setting.findUnique({
    where: { ownerId_key: { ownerId: userId, key } },
    select: { value: true },
  });
  return row?.value ?? null;
}

// Generic write (upsert) of one setting for the caller. Composite PK { ownerId, key }
// guarantees the write only ever touches the caller's own row.
export function setSetting(userId: string, key: string, value: string, db: PrismaClient = prisma) {
  return db.setting.upsert({
    where: { ownerId_key: { ownerId: userId, key } },
    create: { ownerId: userId, key, value },
    update: { value },
  });
}

// All of the caller's settings as a plain key→value map (for hydrating the profile
// sheet in one read). Scoped to ownerId.
export async function getAllSettings(userId: string, db: PrismaClient = prisma): Promise<Record<string, string>> {
  const rows = await db.setting.findMany({ where: { ownerId: userId }, select: { key: true, value: true } });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// Every typed setting, decoded from an already-fetched key→value map.
//
// THE BUG THIS KILLS: the app shell used to await five separate typed accessors in a
// row, each doing its own findUnique — five serial serverless-Postgres round-trips
// gating EVERY page render, for five rows of the same table belonging to the same user.
// The fix is class-level rather than "batch these five": decoding is now split from
// fetching, so the shell fetches once with `getAllSettings` and decodes in memory, and
// any setting added later joins that single read for free instead of adding a sixth
// trip. The per-setting accessors below stay for callers that genuinely want one value.
//
// Defaults and clamping are IDENTICAL to the individual accessors — this is the one
// place the rules live, so the two paths can never drift apart.
export type ResolvedSettings = {
  crossfadeSec: number;
  lyricsEnabled: boolean;
  preferAudio: boolean;
  autoplaySimilar: boolean;
  volume: number;
};

// The values a signed-out / keyless / failed read must degrade to. Honest defaults,
// never a crash and never a silently muted or over-driven player.
export const DEFAULT_SETTINGS: ResolvedSettings = {
  crossfadeSec: CROSSFADE_DEFAULT_SEC,
  lyricsEnabled: true,
  preferAudio: true,
  autoplaySimilar: true,
  volume: VOLUME_DEFAULT,
};

function decodeBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback;
  return raw === "true";
}

export function decodeSettings(map: Record<string, string>): ResolvedSettings {
  const rawCrossfade = map[SETTING_KEYS.crossfadeSec];
  const crossfade = rawCrossfade == null ? NaN : Number(rawCrossfade);
  const rawVolume = map[SETTING_KEYS.volume];
  const volume = rawVolume == null ? NaN : Number(rawVolume);
  return {
    crossfadeSec: Number.isFinite(crossfade)
      ? Math.min(CROSSFADE_MAX_SEC, Math.max(CROSSFADE_MIN_SEC, Math.round(crossfade)))
      : CROSSFADE_DEFAULT_SEC,
    lyricsEnabled: decodeBool(map[SETTING_KEYS.lyricsEnabled], true),
    preferAudio: decodeBool(map[SETTING_KEYS.preferAudio], true),
    autoplaySimilar: decodeBool(map[SETTING_KEYS.autoplaySimilar], true),
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : VOLUME_DEFAULT,
  };
}

// All of the caller's typed settings in ONE query. This is what the app shell uses.
export async function getResolvedSettings(
  userId: string,
  db: PrismaClient = prisma,
): Promise<ResolvedSettings> {
  return decodeSettings(await getAllSettings(userId, db));
}

// Typed crossfade-length accessors (used by U11). Read clamps + falls back to the
// default so a corrupt/unset value degrades honestly rather than breaking the engine.
export async function getCrossfadeSec(userId: string, db: PrismaClient = prisma): Promise<number> {
  const raw = await getSetting(userId, SETTING_KEYS.crossfadeSec, db);
  const parsed = raw == null ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return CROSSFADE_DEFAULT_SEC;
  return Math.min(CROSSFADE_MAX_SEC, Math.max(CROSSFADE_MIN_SEC, Math.round(parsed)));
}

export function setCrossfadeSec(userId: string, seconds: number, db: PrismaClient = prisma) {
  const clamped = Math.min(CROSSFADE_MAX_SEC, Math.max(CROSSFADE_MIN_SEC, Math.round(seconds)));
  return setSetting(userId, SETTING_KEYS.crossfadeSec, String(clamped), db);
}

// Typed lyrics on/off accessors (used by U9). Defaults ON — lyrics are a headline
// feature; the user turns them off explicitly.
export async function getLyricsEnabled(userId: string, db: PrismaClient = prisma): Promise<boolean> {
  const raw = await getSetting(userId, SETTING_KEYS.lyricsEnabled, db);
  if (raw == null) return true;
  return raw === "true";
}

export function setLyricsEnabled(userId: string, enabled: boolean, db: PrismaClient = prisma) {
  return setSetting(userId, SETTING_KEYS.lyricsEnabled, enabled ? "true" : "false", db);
}

// Typed "prefer audio versions" accessors (Complaint 1). When on, search floats official
// audio versions (Topic-channel uploads, "Official Audio" titles) above music videos, so
// Fuse behaves like a music app rather than a video app. Defaults ON — it is the music-
// first default a listener expects; the user turns it off to see videos in raw order.
export async function getPreferAudio(userId: string, db: PrismaClient = prisma): Promise<boolean> {
  const raw = await getSetting(userId, SETTING_KEYS.preferAudio, db);
  if (raw == null) return true;
  return raw === "true";
}

export function setPreferAudio(userId: string, enabled: boolean, db: PrismaClient = prisma) {
  return setSetting(userId, SETTING_KEYS.preferAudio, enabled ? "true" : "false", db);
}

// Typed "autoplay similar when the queue ends" accessors (Wave 1 — radio continuation).
// When on, the player keeps listening going with similar tracks once the queue runs out
// (seeded from the last track), instead of stopping dead. This is the ONE sanctioned
// auto-play — user-consented via this visible setting and announced on screen by the
// Now Playing banner. Defaults ON: a queue that stops dead reads as broken to a switcher;
// the user turns it off to make the music stop at the end of the queue.
export async function getAutoplaySimilar(userId: string, db: PrismaClient = prisma): Promise<boolean> {
  const raw = await getSetting(userId, SETTING_KEYS.autoplaySimilar, db);
  if (raw == null) return true;
  return raw === "true";
}

export function setAutoplaySimilar(userId: string, enabled: boolean, db: PrismaClient = prisma) {
  return setSetting(userId, SETTING_KEYS.autoplaySimilar, enabled ? "true" : "false", db);
}

// Typed output-volume accessors (owner fix 3). Read clamps to 0..1 and falls back to full
// so a corrupt/unset value degrades honestly rather than muting or over-driving the engine.
export async function getVolume(userId: string, db: PrismaClient = prisma): Promise<number> {
  const raw = await getSetting(userId, SETTING_KEYS.volume, db);
  const parsed = raw == null ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return VOLUME_DEFAULT;
  return Math.min(1, Math.max(0, parsed));
}

export function setVolume(userId: string, volume: number, db: PrismaClient = prisma) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : VOLUME_DEFAULT));
  return setSetting(userId, SETTING_KEYS.volume, String(clamped), db);
}
