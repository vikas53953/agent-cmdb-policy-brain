// DJ console session rehydration (F-6) — the sibling of lib/session-state.ts.
//
// THE BUG: the whole DJ console lived in React component state on the /dj route. Tapping
// Home unmounted that route, so React threw the lot away: the loaded track, the EQ, the
// crossfader position, the curve, the trim, the filter — everything. Coming back gave you
// a factory-fresh console. For a screen whose entire job is holding a set-up mix, that is
// the console forgetting your set every time you glance at something else.
//
// THE HONEST FIX, following exactly what the main player already does for a reload:
// persist a SMALL snapshot to sessionStorage whenever it changes, and restore it on the
// next mount — restored PAUSED, never mid-play, because the no-uninvited-music law is
// absolute and applies to the decks as much as the mini-player.
//
// WHY sessionStorage (not localStorage): same reasoning as the player's snapshot. This is
// for "I nipped to Home and came back" and for an accidental reload inside the same tab —
// not for resurrecting last Tuesday's set in a new window. sessionStorage is per-tab and
// dies with the tab, which is precisely that scope.
//
// WHAT IS DELIBERATELY NOT PERSISTED:
//   • The decoded local audio itself. A File cannot be serialised, and holding the bytes
//     would break the promise that your files never leave your device (R14). We keep the
//     NAME only, so the deck can say which file needs picking again rather than silently
//     presenting an empty deck with all your knobs mysteriously set.
//   • Hot cues. Those are already saved server-side per user+track fingerprint, so they
//     come back through their own path — persisting them here would create a second,
//     competing truth.
//   • An armed beat loop. A loop is a region of a specific decoded buffer; with no buffer
//     to restore it onto there is nothing for it to mean, and showing a lit Loop button
//     over silence would be exactly the decorative-control dishonesty this app refuses.
//   • Play/pause. A restore is always paused.
//
// Everything here is pure and SSR-safe: every function guards on `window`/`sessionStorage`
// and swallows quota/parse errors, so a private-mode browser or a corrupt entry degrades
// to "nothing to restore" rather than throwing.

import type { TrackSource } from "@/lib/repos/track";
import type { CrossfadeCurve } from "@/components/dj/deck-model";

// Bump when the persisted SHAPE changes so a stale entry from an older build is ignored
// rather than mis-parsed.
const DJ_KEY = "fuse:dj:v1";

export type DjDeckSession = {
  source: TrackSource | null;
  // YouTube decks CAN be fully restored — the video id is all the player needs.
  youtubeId: string | null;
  // My Files decks can restore everything EXCEPT the audio. The name is kept so the deck
  // can name the file the DJ needs to pick again.
  localFileName: string | null;
  rate: number;
  eq: { low: number; mid: number; high: number };
  kills: { low: boolean; mid: boolean; high: boolean };
  filterAmt: number;
  trim: number;
  echo: boolean;
};

export type DjSession = {
  a: DjDeckSession;
  b: DjDeckSession;
  // Crossfader position, 0 = full Deck A … 1 = full Deck B.
  position: number;
  curve: CrossfadeCurve;
};

export const EMPTY_DECK_SESSION: DjDeckSession = {
  source: null,
  youtubeId: null,
  localFileName: null,
  rate: 1,
  eq: { low: 0, mid: 0, high: 0 },
  kills: { low: false, mid: false, high: false },
  filterAmt: 0,
  trim: 1,
  echo: false,
};

export const EMPTY_DJ_SESSION: DjSession = {
  a: EMPTY_DECK_SESSION,
  b: EMPTY_DECK_SESSION,
  position: 0.5,
  curve: "smooth",
};

const SOURCES: readonly string[] = ["local", "youtube", "spotify"];
const CURVES: readonly string[] = ["smooth", "linear", "sharp"];

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null; // sessionStorage access can throw in locked-down / private modes
  }
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// Narrow an unknown into a deck snapshot, falling back field by field. A half-corrupt
// entry restores what it honestly can rather than losing the whole console.
function asDeck(v: unknown): DjDeckSession {
  if (!v || typeof v !== "object") return EMPTY_DECK_SESSION;
  const d = v as Record<string, unknown>;
  const eq = (d.eq ?? {}) as Record<string, unknown>;
  const kills = (d.kills ?? {}) as Record<string, unknown>;
  const source = typeof d.source === "string" && SOURCES.includes(d.source)
    ? (d.source as TrackSource)
    : null;
  return {
    source,
    youtubeId: str(d.youtubeId),
    localFileName: str(d.localFileName),
    rate: num(d.rate, 1, 0.25, 2),
    eq: {
      low: num(eq.low, 0, -30, 30),
      mid: num(eq.mid, 0, -30, 30),
      high: num(eq.high, 0, -30, 30),
    },
    kills: {
      low: bool(kills.low, false),
      mid: bool(kills.mid, false),
      high: bool(kills.high, false),
    },
    filterAmt: num(d.filterAmt, 0, -1, 1),
    trim: num(d.trim, 1, 0, 2),
    echo: bool(d.echo, false),
  };
}

// Persist the console snapshot, or clear it when the console is back to factory-fresh.
export function saveDjSession(session: DjSession | null): void {
  const s = storage();
  if (!s) return;
  try {
    if (!session) {
      s.removeItem(DJ_KEY);
      return;
    }
    s.setItem(DJ_KEY, JSON.stringify(session));
  } catch {
    // Best-effort — a full or blocked store must never break the decks.
  }
}

// Read back the persisted console snapshot, or null when there is nothing valid to
// restore. A malformed entry reads as null (and is never thrown from).
export function loadDjSession(): DjSession | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(DJ_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      a: asDeck(parsed.a),
      b: asDeck(parsed.b),
      position: num(parsed.position, 0.5, 0, 1),
      curve:
        typeof parsed.curve === "string" && CURVES.includes(parsed.curve)
          ? (parsed.curve as CrossfadeCurve)
          : "smooth",
    };
  } catch {
    return null;
  }
}

export function clearDjSession(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(DJ_KEY);
  } catch {
    /* best-effort */
  }
}

// Does this restored deck need the DJ to pick its file again? True only for a My Files
// deck that had a file loaded — the one thing a snapshot honestly cannot bring back.
export function needsFileAgain(deck: DjDeckSession): boolean {
  return deck.source === "local" && deck.localFileName !== null;
}

// The plain-words line a deck shows when its settings came back but its audio could not.
// Says what happened, why, and what to do — and frames the cause as the promise being
// kept, because that is exactly what it is.
export function fileAgainNotice(fileName: string): string {
  return `Your knobs are as you left them. Pick “${fileName}” again to play it — it stays on your device, so we can't hold onto it for you.`;
}
