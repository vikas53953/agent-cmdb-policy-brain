// Lightweight session rehydration (FIX 2, R1/R3/R4 sibling).
//
// THE BUG: refreshing the page mid-song reset the mini-player to "Nothing playing yet"
// and blanked the search screen — all playback truth lived only in memory, so a reload
// wiped it. THE HONEST FIX: persist a SMALL snapshot (current track metadata + position
// + queue + the search query) to sessionStorage on change, and on the next load restore
// the mini-player with the SAME track PAUSED at the saved position (a play button, never
// auto-play — the no-uninvited-music law is absolute) and restore the search query so the
// results view re-runs through the normal search path.
//
// WHY sessionStorage (not localStorage): the restore is meant for an accidental reload or
// a crash within the SAME tab session, not to resurrect a song days later in a new window.
// sessionStorage is per-tab and cleared when the tab closes — exactly that scope.
//
// Everything here is pure and SSR-safe: every function guards on `window`/`sessionStorage`
// and swallows quota/parse errors, so a private-mode browser or a corrupt entry degrades
// to "nothing to restore" rather than throwing.

import type { TrackRef } from "@/lib/repos/track";

// Bump when the persisted SHAPE changes so a stale entry from an older build is ignored
// rather than mis-parsed.
const PLAYER_KEY = "fuse:player:v1";
const SEARCH_KEY = "fuse:search:v1";

// The minimal playback snapshot worth restoring. Deliberately small — just enough to
// re-show the mini-player paused on the right track at the right spot, and to re-seed the
// up-next queue. NOT persisted: isPlaying/intent (a restore is ALWAYS paused), engine and
// recovery internals (rebuilt fresh on the next real play).
export type PlayerSession = {
  current: TrackRef;
  queue: TrackRef[];
  positionSec: number;
  durationSec: number;
  // The Previous back-stack (Wave 1), so "go back a song" survives an accidental reload
  // within the tab session. Optional/absent on older snapshots — restored as [] then.
  history?: TrackRef[];
};

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null; // access to sessionStorage can throw in locked-down/private modes
  }
}

// Narrow an unknown into a TrackRef, or null. Keeps a corrupt entry from poisoning the
// store — a missing source/nativeId means we cannot honestly restore that track.
function asTrack(v: unknown): TrackRef | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  if (typeof t.source !== "string" || typeof t.nativeId !== "string") return null;
  return {
    source: t.source as TrackRef["source"],
    nativeId: t.nativeId,
    title: typeof t.title === "string" ? t.title : "Untitled",
    artist: typeof t.artist === "string" ? t.artist : null,
    artUrl: typeof t.artUrl === "string" ? t.artUrl : null,
    durationSec: typeof t.durationSec === "number" ? t.durationSec : null,
  };
}

// Persist the current playback snapshot, or clear it when nothing is playing/focused.
export function savePlayerSession(session: PlayerSession | null): void {
  const s = storage();
  if (!s) return;
  try {
    if (!session || !session.current) {
      s.removeItem(PLAYER_KEY);
      return;
    }
    const snapshot: PlayerSession = {
      current: session.current,
      queue: session.queue ?? [],
      positionSec: Math.max(0, session.positionSec || 0),
      durationSec: Math.max(0, session.durationSec || 0),
      history: session.history ?? [],
    };
    s.setItem(PLAYER_KEY, JSON.stringify(snapshot));
  } catch {
    // Best-effort — a full/blocked store must never break playback.
  }
}

// Read back the persisted playback snapshot, or null when there is nothing valid to
// restore. A malformed entry reads as null (and is not thrown from).
export function loadPlayerSession(): PlayerSession | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(PLAYER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const current = asTrack(parsed.current);
    if (!current) return null;
    const queue = Array.isArray(parsed.queue)
      ? parsed.queue.map(asTrack).filter((t): t is TrackRef => t !== null)
      : [];
    const history = Array.isArray(parsed.history)
      ? parsed.history.map(asTrack).filter((t): t is TrackRef => t !== null)
      : [];
    return {
      current,
      queue,
      positionSec: typeof parsed.positionSec === "number" ? Math.max(0, parsed.positionSec) : 0,
      durationSec: typeof parsed.durationSec === "number" ? Math.max(0, parsed.durationSec) : 0,
      history,
    };
  } catch {
    return null;
  }
}

export function clearPlayerSession(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(PLAYER_KEY);
  } catch {
    /* best-effort */
  }
}

// The last search query the user typed, so the Search screen restores its query+results
// after a reload by re-running it through the normal (cache-served) search path.
export function saveSearchQuery(query: string): void {
  const s = storage();
  if (!s) return;
  try {
    if (query.trim() === "") s.removeItem(SEARCH_KEY);
    else s.setItem(SEARCH_KEY, query);
  } catch {
    /* best-effort */
  }
}

export function loadSearchQuery(): string {
  const s = storage();
  if (!s) return "";
  try {
    return s.getItem(SEARCH_KEY) ?? "";
  } catch {
    return "";
  }
}
