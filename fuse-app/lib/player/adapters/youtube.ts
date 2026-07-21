// YouTube playback adapter — the VISIBLE IFrame player (U7, R2/R4/R5, KTD-6, KTD-7).
//
// This is the first concrete SourceAdapter to feed the unified store. It wraps the
// YouTube IFrame Player API and reports position/duration back into the store so
// every UI surface (mini-player, Now Playing) renders from one truth.
//
// THE VISIBLE-PLAYER RULE (KTD-7) is the whole point of this file. YouTube's ToS
// requires the playing video to be an on-screen element (>50% visible; no hidden/
// background playback). The player lives inside a single owned host element.
//
// THE OWNERSHIP FIX (R1/R3/R4). The old model RE-PARENTED that host into whichever
// screen surface was on screen (mini / Now Playing / melt) with container.appendChild.
// That was fatal: re-inserting an <iframe> node RELOADS its src in every browser, so
// opening/closing Now Playing, switching tabs, or a blend promotion silently reloaded
// the video — it self-played (autoplay re-applied → R1), reset to 0 and switched track
// (R3), and froze the polled clock so the recovery monitor cried "stall" (R4). The fix:
// in the app the adapter is given a HOST COORDINATOR (lib/player/host-coordinator.ts)
// that owns ONE never-re-parented, position:fixed host and moves it by GEOMETRY over the
// active on-screen slot. The iframe never moves in the DOM, so it never reloads. A blend
// promotion is a geometry swap (promoteIncoming), never an appendChild.
//
// TWO MODES. When a coordinator is injected (the app's shared singleton) the adapter runs
// in geometry mode: it builds its player inside the coordinator's host and never touches
// screen containers. When NO coordinator is injected (each DJ deck's private adapter, and
// unit tests) it runs in DIRECT mode: mount()/unmount() appendChild the host into a
// STABLE deck container that never moves — so the reparent-reload bug cannot occur there.
//
// HONESTY (R17): the adapter registers itself into the shared registry at module load,
// which flips YouTube search results from disabled to a real, enabled play button.
//
// SSR / no-DOM SAFETY: module load only creates the adapter object and registers it (both
// pure). Every DOM/API touch is deferred and guarded on `doc`, so tsc / vitest / next
// build all run with no window and no env vars.

import type { TrackRef } from "@/lib/repos/track";
import type {
  EngineState,
  SourceAdapter,
  SourceCapabilities,
} from "@/lib/player/types";
import { adapterRegistry } from "@/lib/player/adapters";
import { SOURCE_CAPABILITIES, YOUTUBE_RATE_RANGE } from "@/lib/player/capabilities";
import { playerStore } from "@/lib/player/store";
import { playerHostCoordinator, type PlayerHostCoordinator } from "@/lib/player/host-coordinator";
import { fakeEngineFactory } from "@/lib/player/fake-engine";
import { logActivity } from "@/lib/activity-log";

// Plain-English messages for the YouTube IFrame API error codes (R18 — errors say what
// went wrong, in words the owner reads without jargon). The activity log is user-visible
// in Settings, so these must be plain. Each names the CAUSE so a diagnostics reader can tell
// "YouTube blocked this here" apart from a passing hiccup apart from "it's gone". The raw
// numeric code is not sensitive, so it is logged alongside as-is for a precise reader.
const YT_ERROR_MESSAGES: Record<number, string> = {
  2: "YouTube couldn't start this video — trying again", // invalid request (possibly transient)
  5: "This video hit a playback snag — trying again", // HTML5 player hiccup (possibly transient)
  100: "This video isn't available anymore", // removed / private
  101: "YouTube won't play this video here", // embed disallowed by the owner
  150: "YouTube won't play this video here", // embed disallowed by the owner
};

// Classify a YT IFrame error for the recovery ladder. 100/101/150 are FATAL for THIS
// video (unavailable, or embedding refused — retrying the same id can never help), so
// the ladder should advance to an alternate. 2/5 are possibly transient (bad request /
// HTML5 hiccup) — worth a recreate before giving up. Also treated as fatal-for-here is
// the datacenter/bot-gated refusal, which surfaces as 150/101 in practice.
function classifyYtError(code: number): "soft" | "fatal" {
  return code === 100 || code === 101 || code === 150 ? "fatal" : "soft";
}

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

// YouTube IFrame player state codes (YT.PlayerState).
const YT_STATE_UNSTARTED = -1;
const YT_STATE_ENDED = 0;
const YT_STATE_PLAYING = 1;
const YT_STATE_PAUSED = 2;
const YT_STATE_BUFFERING = 3;
const YT_STATE_CUED = 5;

// Map a raw YT.PlayerState code to our source-agnostic EngineState. Cued/unstarted both
// read as "unstarted" (nothing has begun); anything unexpected as "unstarted" too.
function toEngineState(code: number): EngineState {
  switch (code) {
    case YT_STATE_PLAYING:
      return "playing";
    case YT_STATE_PAUSED:
      return "paused";
    case YT_STATE_BUFFERING:
      return "buffering";
    case YT_STATE_ENDED:
      return "ended";
    case YT_STATE_UNSTARTED:
    case YT_STATE_CUED:
    default:
      return "unstarted";
  }
}

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
  // `reason` lets a GENUINE end-of-track advance ("ended") be told apart from a manual skip
  // so the store can honour the sleep timer's "stop at end of track" (Wave 1). Optional so
  // existing callers/fakes that pass nothing still type-check.
  next(reason?: "ended" | "user"): Promise<boolean>;
  // Report a hard engine error for the current track so the store's recovery ladder can
  // escalate honestly (recreate / offer Skip) instead of a silent freeze.
  reportError(info: { message: string; kind: "soft" | "fatal"; code?: number }): void;
  // OPTIONAL: mirror the engine's own lifecycle state into the store so the recovery
  // monitor can gate a stall on real engine state, not just a polled clock. A deck's
  // private bridge (preview-only, no global recovery) omits it.
  reportEngineState?(state: EngineState): void;
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

// A YouTube adapter is a SourceAdapter PLUS the mount/unmount surface the DIRECT-mode
// host (each DJ deck's stable video container) uses, PLUS the two-player blend surface
// the auto-crossfade engine (U11) drives.
//
// In GEOMETRY mode (a coordinator is injected — the app's main player) mount/unmount are
// no-ops: the on-screen home is chosen by the host coordinator via slots that the screen
// components register directly, never by re-parenting the iframe.
export type YouTubeAdapter = SourceAdapter & {
  // DIRECT mode only: appendChild the owned host into a stable container (a DJ deck).
  // Never used in geometry mode.
  mount(container: HTMLElement): void;
  // DIRECT mode only: detach from a container without destroying the player.
  unmount(container: HTMLElement): void;

  // ── Auto-crossfade blend surface (U11) ──────────────────────────────────────
  // Warm a SECOND, visible iframe on the incoming track and start it playing. This
  // is the real overlap: the primary keeps playing the outgoing track while this
  // incoming player plays too, so the two genuinely cross-ramp (never a hidden
  // player — the incoming lives in the melt panel via mountIncoming, KTD-7).
  beginBlend(track: TrackRef): Promise<void>;
  // Set the two players' volumes during the ramp (0..1 each) — the equal-power
  // crossfade the blend engine computes.
  setBlendVolumes(outgoing01: number, incoming01: number): void;
  // Promote the incoming player to primary with NO reload (the audio the user hears
  // continues seamlessly), retire the old primary, and move the new primary back into
  // the on-screen primary container.
  completeBlend(): void;
  // Abandon an in-flight blend: destroy the incoming player, leaving the primary as-is.
  cancelBlend(): void;
  // Mount / release the INCOMING player's host in the melt panel's visible surface.
  mountIncoming(container: HTMLElement): void;
  unmountIncoming(container: HTMLElement): void;
};

export type YouTubeAdapterDeps = {
  factory?: YtPlayerFactory;
  store?: PlayerBridge;
  doc?: DocumentLike | null;
  timers?: Timers;
  // Inject the host coordinator to run in GEOMETRY mode (the app's main player). Omit for
  // DIRECT mode (DJ decks, unit tests). Pass `null` to force direct mode explicitly.
  coordinator?: PlayerHostCoordinator | null;
};

export function createYouTubeAdapter(deps: YouTubeAdapterDeps = {}): YouTubeAdapter {
  const doc: DocumentLike | null =
    deps.doc ?? (typeof document !== "undefined" ? document : null);
  const factory: YtPlayerFactory = deps.factory ?? defaultFactory;
  // store.ts never imports this adapter, so there is no import cycle — the shared
  // playerStore is safe to reference directly as the default bridge.
  const store: PlayerBridge = deps.store ?? playerStore;
  // Geometry mode when a coordinator is present; direct mode otherwise. `deps.coordinator`
  // may be explicitly null (DJ / tests) — only `undefined` is unset, and even then direct
  // mode is the safe default (tests never pass a coordinator).
  const coordinator: PlayerHostCoordinator | null = deps.coordinator ?? null;
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
  // The latest engine lifecycle state for the PRIMARY player, mirrored to the store.
  let engineState: EngineState = "unstarted";

  // Direct-mode only: the on-screen container the PRIMARY player currently lives in.
  let primaryContainer: HTMLElement | null = null;

  // The SECOND player used only during an auto-crossfade (U11). It plays the incoming
  // track while the primary still plays the outgoing one — the real overlap. Null
  // whenever no blend is in flight.
  let incoming: { player: YtPlayerHandle; host: HTMLElement } | null = null;
  let incomingContainer: HTMLElement | null = null;

  function setEngineState(next: EngineState): void {
    engineState = next;
    store.reportEngineState?.(next);
  }

  // The host the PRIMARY player lives in. In geometry mode this is the coordinator's ONE
  // never-re-parented host; in direct mode it is an internal element the deck mounts.
  function ensureHost(): HTMLElement | null {
    if (coordinator) return coordinator.primaryHost();
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
    // Mirror the engine's own lifecycle into the store so the recovery monitor gates a
    // stall on real engine state (playing/buffering) — never on a paused/ended track.
    setEngineState(toEngineState(state));
    // When a track genuinely ends, advance the queue. This is driven by the REAL engine
    // 'ended' event (a legitimate end-of-track advance), never by a position-delta guess.
    if (state === YT_STATE_ENDED) void store.next("ended");
  }

  // ── The engine-truth router (the F-1 class fix) ────────────────────────────────
  //
  // THE CLASS BUG THIS KILLS: "engine truth goes stale when a player changes role".
  // Every player this adapter builds can become the primary — the auto-crossfade's
  // incoming player is PROMOTED to primary by completeBlend() with no reload. Previously
  // the incoming was built with stub callbacks (`onStateChange: () => {}`), so the moment
  // it was promoted the app's primary player stopped reporting its lifecycle to the store
  // altogether. `engineState` froze at the "playing" that completeBlend hardcoded, and the
  // engine's own ENDED event never reached store.next() again. From the first crossfade on,
  // every end-of-track (and every real buffer/pause the engine reported) looked to the
  // recovery ladder like "the user wants sound, the engine claims to be playing, and the
  // clock is frozen" — i.e. a stall. That is the recurring "Playback stalled — retrying".
  //
  // The fix is structural, not a threshold tweak: EVERY player is wired with the SAME real
  // callbacks, and the store only ever hears from whichever player is currently primary.
  // Role is decided by identity at emit time, so a promotion can never silently disconnect
  // the engine's truth, and a not-yet-promoted incoming can never speak for the primary
  // (its ENDED must not advance the queue while it is still melting in).
  function eventsFor(self: { handle: YtPlayerHandle | null }): YtPlayerCallbacks {
    const isPrimary = () => self.handle !== null && self.handle === player;
    return {
      onReady: () => {},
      onStateChange: (state) => {
        if (!isPrimary()) return;
        onStateChange(state);
      },
      onError: (code) => {
        const message = YT_ERROR_MESSAGES[code] ?? "YouTube couldn't play this video";
        if (!isPrimary()) {
          // A blend's INCOMING player failing is not the current track's error — the primary
          // keeps playing, so the listener sees nothing. Log it as a breadcrumb (info level,
          // stall-tagged) so it stays diagnosable (R18) WITHOUT inflating the error count or
          // arming the ladder against a healthy primary. Never routing — telemetry only.
          logActivity({ level: "info", type: "stall-blend-error", message, detail: { code } });
          return;
        }
        // Propagate into the store so the recovery ladder can act (R18, AE1): a fatal embed
        // refusal offers Skip; a soft error tries a recreate first.
        setEngineState("error");
        store.reportError({ message, kind: classifyYtError(code), code });
      },
    };
  }

  return {
    source: "youtube",
    capabilities: YOUTUBE_CAPABILITIES,

    getEngineState(): EngineState {
      return engineState;
    },

    mount(container: HTMLElement): void {
      // Geometry mode: the on-screen home is chosen by the coordinator via registered
      // slots, never by re-parenting. mount is a no-op here.
      if (coordinator) return;
      const h = ensureHost();
      if (!h) return;
      // Direct mode (a DJ deck): the container is stable and mounts once, so this
      // appendChild happens a single time and never triggers a reparent-reload.
      primaryContainer = container;
      container.appendChild(h);
    },

    unmount(container: HTMLElement): void {
      if (coordinator) return; // geometry mode: nothing to detach
      if (host && host.parentElement === container) {
        const p = ensurePark();
        if (p) p.appendChild(host);
      }
      if (primaryContainer === container) primaryContainer = null;
    },

    // ── Auto-crossfade blend surface (U11) ──────────────────────────────────────

    async beginBlend(track: TrackRef): Promise<void> {
      if (!doc && !coordinator) return; // no DOM: honestly cannot overlap, caller falls back
      // A stale incoming from an abandoned blend is torn down first.
      if (incoming) {
        incoming.player.destroy();
        incoming = null;
      }
      // The incoming player's home. In geometry mode it is the coordinator's second
      // (incoming) host, positioned over the melt slot — never re-parented. In direct
      // mode it is a fresh element parked/mounted the old way.
      let ihost: HTMLElement | null;
      if (coordinator) {
        ihost = coordinator.incomingHost();
      } else {
        ihost = doc!.createElement("div");
        ihost.className = "yt-host";
        if (incomingContainer) incomingContainer.appendChild(ihost);
        else ensurePark()?.appendChild(ihost);
      }
      if (!ihost || !doc) return;

      const target = doc.createElement("div");
      ihost.appendChild(target);
      // The incoming gets the SAME real callbacks as any primary (the F-1 class fix). The
      // router silences them while it is merely melting in, and — crucially — keeps them
      // live once completeBlend promotes this exact player to primary, so the app never
      // ends up with a primary whose engine lifecycle is invisible to the recovery ladder.
      const self: { handle: YtPlayerHandle | null } = { handle: null };
      const iplayer = await factory(target, track.nativeId, eventsFor(self));
      self.handle = iplayer;
      incoming = { player: iplayer, host: ihost };
      if (coordinator) coordinator.setPlaybackLive("incoming", true);
      // The real factory resolves only after the player is ready, so it is safe to
      // start playback now. It begins silent (setBlendVolumes(…, 0) precedes this).
      iplayer.playVideo();
    },

    setBlendVolumes(outgoing01: number, incoming01: number): void {
      const outC = Math.max(0, Math.min(1, outgoing01));
      const inC = Math.max(0, Math.min(1, incoming01));
      player?.setVolume(outC * 100);
      incoming?.player.setVolume(inC * 100);
    },

    completeBlend(): void {
      if (!incoming) return;
      // Retire the outgoing (old primary) and stop its poll.
      stopPolling();
      if (player) player.destroy();
      // Promote the incoming player to primary — NO reload, so its audio continues.
      player = incoming.player;
      host = incoming.host;
      ready = true;
      readyResolvers = [];
      // The incoming was already playing, so mirror that as the primary engine state
      // immediately. From here its OWN callbacks are live (the router now sees it as
      // primary), so every later buffer / pause / ENDED reaches the store for real —
      // which is what stops a normal end-of-track being misread as a stall.
      setEngineState("playing");
      if (coordinator) {
        // Geometry swap, NOT a DOM reparent: the element that holds the still-playing
        // iframe becomes the primary geometry-follower; the emptied old primary becomes
        // the reusable incoming host. The iframe never moves → never reloads.
        coordinator.promoteIncoming();
        coordinator.setPlaybackLive("primary", true);
        coordinator.setPlaybackLive("incoming", false);
      } else {
        // Direct mode: re-home the promoted host onto the primary container (or park it).
        if (primaryContainer) primaryContainer.appendChild(host);
        else ensurePark()?.appendChild(host);
      }
      incoming = null;
      incomingContainer = null;
      startPolling();
    },

    cancelBlend(): void {
      if (!incoming) return;
      incoming.player.destroy();
      if (coordinator) coordinator.setPlaybackLive("incoming", false);
      else if (incoming.host) ensurePark()?.appendChild(incoming.host);
      incoming = null;
      incomingContainer = null;
    },

    mountIncoming(container: HTMLElement): void {
      // Geometry mode: the melt slot is registered directly with the coordinator by the
      // melt panel; nothing to move here.
      if (coordinator) return;
      incomingContainer = container;
      if (incoming?.host) container.appendChild(incoming.host);
    },

    unmountIncoming(container: HTMLElement): void {
      if (coordinator) return;
      if (incoming?.host && incoming.host.parentElement === container) {
        ensurePark()?.appendChild(incoming.host);
      }
      if (incomingContainer === container) incomingContainer = null;
    },

    async load(track: TrackRef): Promise<void> {
      const h = ensureHost();
      // No DOM (SSR / node): honestly do nothing rather than pretend to load.
      if (!h) return;

      if (!player) {
        // Direct mode: give the host a home in the DOM so the player can initialise even if
        // no deck container has mounted yet. Geometry mode: the coordinator's host is
        // already parented to <body> once and never moves, so there is nothing to do.
        if (!coordinator && !h.parentElement) {
          const p = ensurePark();
          p?.appendChild(h);
        }
        const target = doc!.createElement("div");
        h.appendChild(target);
        ready = false;
        engineState = "unstarted";
        if (coordinator) coordinator.setPlaybackLive("primary", true);
        // Identity box for the router: the callbacks close over it and it is filled the
        // instant the handle exists, so this player's events are attributed to the right
        // role for its whole life (including after a later promotion).
        const self: { handle: YtPlayerHandle | null } = { handle: null };
        const events = eventsFor(self);
        const created = await factory(target, track.nativeId, {
          ...events,
          onReady: () => {
            ready = true;
            flushReady();
            startPolling();
          },
        });
        // Both assignments before any awaited work, so no event can observe a half-set role.
        self.handle = created;
        player = created;
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
      // A real video is now playing: the ToS "keep the player visible" obligation is live,
      // so the coordinator keeps a visible box (over the active slot, or a fallback chip).
      if (coordinator) coordinator.setPlaybackLive("primary", true);
    },

    pause(): void {
      player?.pauseVideo();
      // Reflect the pause immediately (the engine's own 'paused' event also confirms it),
      // so the recovery monitor sees "not playing" without waiting for the state event.
      if (player) setEngineState("paused");
      // A PAUSED video carries no ToS visibility obligation, so playback is no longer
      // "live" for the coordinator. This is what kills the orphaned fallback chip: when a
      // screen with no player slot (the DJ console) pauses the main track, the host hides
      // instead of stranding a small, uncontrollable video over the console. On a screen
      // that DOES have a slot (mini/Now Playing) the paused frame still shows in that slot,
      // because a present slot always wins over the live flag.
      if (player && coordinator) coordinator.setPlaybackLive("primary", false);
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
      engineState = "unstarted";
      if (coordinator) coordinator.setPlaybackLive("primary", false);
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
  // Deterministic-test gate (fail-closed, mirrors robot-door): only when a STRONG flag is
  // present does the app swap in the in-DOM fake engine, so specs assert exact positions
  // without YouTube network flakiness. Unset / weak → the real IFrame API, always.
  const fake = fakeEngineFactory();
  if (fake) return fake(target, videoId, callbacks);

  const YT = await loadYouTubeIframeApi();
  return new Promise<YtPlayerHandle>((resolve) => {
    const player = new YT.Player(target, {
      videoId,
      playerVars: {
        // autoplay:0 (belt-and-suspenders for R1): with no reparent-reloads possible, a
        // reload can never self-start audio. First play is issued explicitly by the store
        // inside the user's tap gesture (adapter.play → playVideo); blends start muted.
        autoplay: 0,
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

// The app's single YouTube adapter. It runs in GEOMETRY mode (the shared host coordinator)
// so its ONE iframe never re-parents and never reloads. Registering it here is what makes
// YouTube search results genuinely playable (R17 honesty).
export const youtubeAdapter = createYouTubeAdapter({ coordinator: playerHostCoordinator });
adapterRegistry.register(youtubeAdapter);
