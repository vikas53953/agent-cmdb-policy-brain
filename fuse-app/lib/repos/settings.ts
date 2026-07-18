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
} as const;

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
