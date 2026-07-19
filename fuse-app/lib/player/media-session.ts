// Media Session — the OS's view of what Fuse is playing.
//
// THE GAP THIS CLOSES: the app never touched `navigator.mediaSession`, so everything the
// operating system draws for a music app was blank or dead — the phone lock screen showed
// nothing, the desktop "now playing" panel was empty, and the play/pause button on a pair
// of headphones, a Bluetooth car stereo, or a keyboard's media keys did nothing at all.
// The player worked only while the user was looking at the tab, which is not what a music
// app is.
//
// WHY THIS SHAPE: everything decidable is a pure function here — what the metadata for a
// track should be, what playback state to publish, and which store call each OS action
// maps to. The React effect that touches `navigator` is a thin shell over these (see
// components/player/media-session-bridge.tsx). That keeps the whole decision surface
// unit-testable in node, where `navigator.mediaSession` does not exist at all.
//
// TRANSPORT IS NOT REIMPLEMENTED. Every handler below delegates to the existing store
// methods, so lock-screen Next obeys shuffle/repeat/radio exactly as the on-screen Next
// does — there is one implementation of "what plays next" and this is not a second one.

import type { TrackRef } from "@/lib/repos/track";

// How far the OS's skip-forward / skip-back buttons move when they do not name an offset.
// Deliberately the same step the keyboard shortcuts use, so "skip ahead" means one thing.
export const MEDIA_SEEK_STEP_SEC = 10;

// Artwork sizes advertised to the OS. Sources hand us ONE cover URL, so all three entries
// point at it; the list exists because some platforms pick by declared size and show
// nothing when the size they want is absent. Cheap — it is the same image either way.
const ARTWORK_SIZES = ["96x96", "256x256", "512x512"] as const;

export type MediaArtworkInit = { src: string; sizes: string; type: string };

export type MediaMetadataInit = {
  title: string;
  artist: string;
  album: string;
  artwork: MediaArtworkInit[];
};

// The metadata the OS should show for a track, or null when nothing is loaded (which the
// bridge publishes as a cleared metadata slot rather than a stale previous track).
export function buildMediaMetadata(track: TrackRef | null): MediaMetadataInit | null {
  if (!track) return null;
  return {
    title: track.title,
    // The lock screen has no concept of "unknown" — an empty string renders as an absent
    // line, which is honest, where the literal string "null" would not be.
    artist: track.artist ?? "",
    album: "",
    artwork: track.artUrl
      ? ARTWORK_SIZES.map((sizes) => ({ src: track.artUrl as string, sizes, type: "" }))
      : [],
  };
}

// What the OS should render on its play/pause button. "none" (rather than "paused") when
// nothing is loaded, so the OS panel disappears instead of offering a dead pause control.
export function mediaPlaybackState(state: {
  current: TrackRef | null;
  isPlaying: boolean;
}): "none" | "playing" | "paused" {
  if (!state.current) return "none";
  return state.isPlaying ? "playing" : "paused";
}

// The position info platforms use to draw a live scrub bar on the lock screen. Returns
// null when there is no honest duration to report — publishing a zero-length track makes
// the OS draw a full or empty bar that lies about where the listener is.
export function buildPositionState(state: {
  positionSec: number;
  durationSec: number;
}): { duration: number; position: number; playbackRate: number } | null {
  const duration = state.durationSec;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const position = Math.min(Math.max(0, state.positionSec), duration);
  return { duration, position, playbackRate: 1 };
}

// The subset of the player store the OS handlers need. Narrow on purpose: it documents
// that Media Session only ever drives EXISTING transport, and it lets the mapping be
// tested against a recording fake without a browser.
export type MediaSessionTarget = {
  resume(): unknown;
  pause(): void;
  next(reason?: "ended" | "user"): unknown;
  previous(): unknown;
  seek(positionSec: number): void;
  getState(): { positionSec: number };
};

// The details object platforms pass to seek actions. All fields optional — Chrome omits
// `seekOffset` when the user has no explicit step in mind, which is what the default is for.
export type MediaActionDetails = {
  seekTime?: number;
  seekOffset?: number;
  fastSeek?: boolean;
};

export type MediaSessionActionName =
  | "play"
  | "pause"
  | "previoustrack"
  | "nexttrack"
  | "seekbackward"
  | "seekforward"
  | "seekto";

export type MediaSessionBinding = {
  action: MediaSessionActionName;
  handler: (details?: MediaActionDetails) => void;
};

// The complete OS-action → store-call mapping. A plain array so the bridge can register
// each entry defensively (a browser that does not support one action throws on that one
// only) and so a test can prove every button reaches the right transport method.
export function buildMediaSessionBindings(target: MediaSessionTarget): MediaSessionBinding[] {
  const seekBy = (delta: number) => {
    target.seek(Math.max(0, target.getState().positionSec + delta));
  };
  return [
    { action: "play", handler: () => void target.resume() },
    { action: "pause", handler: () => target.pause() },
    // "user" is the honest reason: a headset click is a manual skip, so the sleep timer's
    // stop-at-end-of-track must survive it exactly as an on-screen Next would.
    { action: "nexttrack", handler: () => void target.next("user") },
    { action: "previoustrack", handler: () => void target.previous() },
    {
      action: "seekbackward",
      handler: (details) => seekBy(-(details?.seekOffset ?? MEDIA_SEEK_STEP_SEC)),
    },
    {
      action: "seekforward",
      handler: (details) => seekBy(details?.seekOffset ?? MEDIA_SEEK_STEP_SEC),
    },
    {
      action: "seekto",
      handler: (details) => {
        // A seekto with no seekTime is meaningless; ignoring it beats jumping to 0:00.
        if (details?.seekTime == null || !Number.isFinite(details.seekTime)) return;
        target.seek(Math.max(0, details.seekTime));
      },
    },
  ];
}

// Whether this runtime actually has the API. Guards BOTH the SSR pass (there is no
// `navigator` at all while Next renders on the server) and browsers that ship without
// Media Session — the bridge must degrade to doing nothing, never throw.
export function hasMediaSession(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}
