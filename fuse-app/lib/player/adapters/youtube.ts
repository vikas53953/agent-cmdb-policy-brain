// YouTube playback adapter — the VISIBLE IFrame player (U7, R2/R4/R5, KTD-6, KTD-7).
//
// This is the first concrete SourceAdapter to feed the unified store. It wraps the
// YouTube IFrame Player API and reports position/duration back into the store so
// every UI surface (mini-player now, Now Playing in U8) renders from one truth.
//
// THE VISIBLE-PLAYER RULE (KTD-7) is the whole point of this file. YouTube's ToS
// requires the playing video to be an on-screen element (min 200x200, >50% visible;
// no hidden/background playback). The OLD app used a hidden 0x0 player — a ToS
// violation and a throttling risk. Here the player lives inside a single owned host
// element that is RE-PARENTED into whichever visible surface is on screen (the
// mini-player art slot in U7; the full Now Playing art surface in U8). Re-parenting
// moves the same <iframe> node, so playback is never torn down and never hidden.
//
// HONESTY (R17): the adapter registers itself into the shared registry at module
// load, which is exactly what flips YouTube search results from "Playback starts
// once the player engine is connected" (disabled) to a real, enabled play button —
// the control only becomes live because the capability behind it now works.
//
// SSR / no-DOM SAFETY: module load does nothing browser-specific beyond creating the
// adapter object and registering it (both pure). Every DOM/API touch is deferred to
// mount()/load() and guarded on `doc` being present, so `tsc`, `vitest` (node), and
// `next build` all run with no window and no env vars.

import type { TrackRef } from "@/lib/repos/track";
import type { SourceAdapter, SourceCapabilities } from "@/lib/player/types";
import { adapterRegistry } from "@/lib/player/adapters";
import { SOURCE_CAPABILITIES, YOUTUBE_RATE_RANGE } from "@/lib/player/capabilities";
import { playerStore } from "@/lib/player/store";
import { logPlaybackError } from "@/lib/activity-log";

// Plain-English messages for the YouTube IFrame API error codes (R18 — errors say
// what went wrong). The raw numeric code is not sensitive, so it is logged as-is.
const YT_ERROR_MESSAGES: Record<number, string> = {
  2: "YouTube rejected the video request",
  5: "The YouTube player hit a playback error",
  100: "This video is unavailable",
  101: "The video's owner does not allow it to be played here",
  150: "The video's owner does not allow it to be played here",
};

// ── Pure helpers (unit-tested without a DOM) ───────────────────────────────────

// YouTube's setPlaybackRate accepts roughly [0.25 .. 2]; anything outside is ignored
// or errors. We clamp so "set speed to 3x" honestly lands at the real 2x ceiling
// (U7 test scenario) rather than silently doing nothing. NaN falls back to 1x.
export function clampPlaybackRate(rate: number): number {
  const [min, max] = YOUTUBE_RATE_RANGE;
  if (Number.isNaN(rate)) return 1;
  return Math.min(max, Math.max(min, rate));
}

// The YouTube column of the DJ capability matrix (single source: capabilities.ts).
export const YOUTUBE_CAPABILITIES: SourceCapabilities = SOURCE_CAPABILITIES.youtube;

// YouTube IFrame player state codes we care about (YT.PlayerState).
const YT_STATE_ENDED = 0;

// How often we mirror the player's clock into the store.
const POLL_MS = 500;

// ── Injectable seams (so the adapter is testable in node) ──────────────────────

// The minimal imperative surface of a YT.Player we actually use. The real factory
// returns a live YT.Player cast to this; tests return a fake that records calls.
export interface YtPlayerHandle {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volumePercent: number): void; // 0..100
  setPlaybackRate(rate: number): void;
  loadVideoById(videoId: string): void;
  cueVideoById(videoId: string): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}

export interface YtPlayerCallbacks {
  onReady(): void;
  onStateChange(state: number): void;
  onError(code: number): void;
}

// Creates a player bound to `target` (a node inside the visible host). Async because
// the real one waits for the IFrame API script and the player's ready event.
export type YtPlayerFactory = (
  target: HTMLElement,
  videoId: string,
  callbacks: YtPlayerCallbacks,
) => Promise<YtPlayerHandle>;

// Only the slice of the store the adapter drives — keeps the dependency narrow and
// lets a fake stand in for it in tests.
export type PlayerBridge = {
  reportPosition(positionSec: number, durationSec?: number): void;
  next(): Promise<boolean>;
};

// The DOM operations the adapter needs — injectable so node tests supply fakes.
export type DocumentLike = {
  createElement(tag: string): HTMLElement;
  body: HTMLElement;
};

export type Timers = {
  setInterval(handler: () => void, ms: number): number;
  clearInterval(id: number): void;
};

// A YouTube adapter is a SourceAdapter PLUS the mount/unmount surface the visible
// video component (video-surface.tsx) uses to hand it the on-screen container.
export type YouTubeAdapter = SourceAdapter & {
  // Re-parent the owned player host into a visible container (KTD-7). Called by the
  // video surface on mount.
  mount(container: HTMLElement): void;
  // Detach from a container without destroying the player, parking the host so React
  // unmounting the surface never tears down live playback.
  unmount(container: HTMLElement): void;
};

export type YouTubeAdapterDeps = {
  factory?: YtPlayerFactory;
  store?: PlayerBridge;
  doc?: DocumentLike | null;
  timers?: Timers;
};

export function createYouTubeAdapter(deps: YouTubeAdapterDeps = {}): YouTubeAdapter {
  const doc: DocumentLike | null =
    deps.doc ?? (typeof document !== "undefined" ? document : null);
  const factory: YtPlayerFactory = deps.factory ?? defaultFactory;
  // store.ts never imports this adapter, so there is no import cycle — the shared
  // playerStore is safe to reference directly as the default bridge.
  const store: PlayerBridge = deps.store ?? playerStore;
  const timers: Timers = deps.timers ?? {
    setInterval: (handler, ms) =>
      globalThis.setInterval(handler, ms) as unknown as number,
    clearInterval: (id) => globalThis.clearInterval(id),
  };

  let player: YtPlayerHandle | null = null;
  let host: HTMLElement | null = null;
  let park: HTMLElement | null = null;
  let ready = false;
  let readyResolvers: Array<() => void> = [];
  let pollId: number | null = null;

  function ensureHost(): HTMLElement | null {
    if (!doc) return null;
    if (!host) {
      host = doc.createElement("div");
      host.className = "yt-host";
    }
    return host;
  }

  // A DOM-attached but off-screen holder so the iframe survives a surface unmount.
  // Playback is only ever parked here transiently (between surfaces / when nothing
  // YouTube is current), never as a way to play hidden — that is the ToS line.
  function ensurePark(): HTMLElement | null {
    if (!doc) return null;
    if (!park) {
      park = doc.createElement("div");
      park.setAttribute("aria-hidden", "true");
      const s = park.style;
      s.position = "absolute";
      s.width = "0";
      s.height = "0";
      s.overflow = "hidden";
      s.left = "-9999px";
      s.top = "0";
      doc.body.appendChild(park);
    }
    return park;
  }

  function whenReady(): Promise<void> {
    if (ready) return Promise.resolve();
    return new Promise<void>((resolve) => readyResolvers.push(resolve));
  }

  function flushReady(): void {
    const resolvers = readyResolvers;
    readyResolvers = [];
    for (const resolve of resolvers) resolve();
  }

  function startPolling(): void {
    if (pollId != null) return;
    pollId = timers.setInterval(() => {
      if (!player || !ready) return;
      const pos = player.getCurrentTime();
      const dur = player.getDuration();
      store.reportPosition(pos > 0 ? pos : 0, dur > 0 ? dur : undefined);
    }, POLL_MS);
  }

  function stopPolling(): void {
    if (pollId != null) {
      timers.clearInterval(pollId);
      pollId = null;
    }
  }

  function onStateChange(state: number): void {
    // When a track ends, advance the queue. The auto-crossfade blend (U11) will layer
    // on top of this; the plain end-of-track advance keeps core listening honest now.
    if (state === YT_STATE_ENDED) void store.next();
  }

  return {
    source: "youtube",
    capabilities: YOUTUBE_CAPABILITIES,

    mount(container: HTMLElement): void {
      const h = ensureHost();
      if (!h) return;
      // Moving the host (and its iframe child) does not reload the video.
      container.appendChild(h);
    },

    unmount(container: HTMLElement): void {
      if (host && host.parentElement === container) {
        const p = ensurePark();
        if (p) p.appendChild(host);
      }
    },

    async load(track: TrackRef): Promise<void> {
      const h = ensureHost();
      // No DOM (SSR / node): honestly do nothing rather than pretend to load.
      if (!h) return;

      if (!player) {
        // Give the host a home in the DOM so the player can initialise even if the
        // visible surface has not mounted yet; mount() re-parents it on screen next.
        if (!h.parentElement) {
          const p = ensurePark();
          p?.appendChild(h);
        }
        const target = doc!.createElement("div");
        h.appendChild(target);
        ready = false;
        player = await factory(target, track.nativeId, {
          onReady: () => {
            ready = true;
            flushReady();
            startPolling();
          },
          onStateChange,
          onError: (code) => {
            // Record the error to the activity log (R18). The stall-detection +
            // retry-then-Skip UX lives in Now Playing (U8, playback-health.ts).
            logPlaybackError(YT_ERROR_MESSAGES[code] ?? "YouTube playback error", {
              code,
            });
          },
        });
      } else {
        // Reuse the one player for the next track — same visible iframe, no teardown.
        player.loadVideoById(track.nativeId);
      }
      await whenReady();
    },

    async play(): Promise<void> {
      if (!player) return;
      await whenReady();
      player.playVideo();
    },

    pause(): void {
      player?.pauseVideo();
    },

    seek(positionSec: number): void {
      player?.seekTo(Math.max(0, positionSec), true);
    },

    setVolume(volume: number): void {
      const clamped = Math.max(0, Math.min(1, volume));
      player?.setVolume(clamped * 100);
    },

    setRate(rate: number): void {
      player?.setPlaybackRate(clampPlaybackRate(rate));
    },

    unload(): void {
      stopPolling();
      if (player) {
        player.destroy();
        player = null;
      }
      ready = false;
      readyResolvers = [];
    },
  };
}

// ── Real browser factory + IFrame API loader (not exercised in node tests) ──────

interface YtPlayerOptions {
  videoId: string;
  playerVars?: Record<string, number>;
  events?: {
    onReady?: () => void;
    onStateChange?: (event: { data: number }) => void;
    onError?: (event: { data: number }) => void;
  };
}

interface YTNamespace {
  Player: new (target: HTMLElement, options: YtPlayerOptions) => YtPlayerHandle;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

// Load https://www.youtube.com/iframe_api once and resolve when window.YT is ready.
// The CSP (lib/security-headers.ts) allows this script host under KTD-9.
function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("YouTube IFrame API needs a browser"));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    if (!document.getElementById("youtube-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "youtube-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return apiPromise;
}

const defaultFactory: YtPlayerFactory = async (target, videoId, callbacks) => {
  const YT = await loadYouTubeIframeApi();
  return new Promise<YtPlayerHandle>((resolve) => {
    const player = new YT.Player(target, {
      videoId,
      playerVars: {
        autoplay: 1, // first play is inside the tap gesture; blends (U11) start muted
        controls: 0,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
      },
      events: {
        onReady: () => {
          callbacks.onReady();
          resolve(player);
        },
        onStateChange: (event) => callbacks.onStateChange(event.data),
        onError: (event) => callbacks.onError(event.data),
      },
    });
  });
};

// The app's single YouTube adapter. Registering it here is what makes YouTube search
// results genuinely playable (R17 honesty): the control is enabled only because this
// working engine is now wired into the shared registry.
export const youtubeAdapter = createYouTubeAdapter();
adapterRegistry.register(youtubeAdapter);
