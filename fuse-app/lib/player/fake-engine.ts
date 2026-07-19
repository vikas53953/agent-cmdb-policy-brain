// Deterministic in-DOM fake YouTube engine (E2E only, fail-closed).
//
// WHY: the real listen.spec runs only against live YouTube and only asserts "settles to
// playing OR honest error" — it never exercises open/minimize/next/idle, so it could not
// see R1-R4, and YouTube's network flakiness makes exact-position assertions impossible.
// This fake is a REAL, visible in-DOM box with a JS clock that advances position while
// intent is "play", reports engine state honestly, and — because the geometry host never
// re-parents — proves the no-reload invariant. It lets e2e assert exact positions and the
// exact activity-log contents that the owner's repro turns on.
//
// FAIL-CLOSED (mirrors robot-door.ts): the fake exists ONLY when a STRONG flag is set. In
// the browser that flag is a build-time public env var (NEXT_PUBLIC_E2E_FAKE_ENGINE) that
// must be at least 32 chars — exactly like the door secret. Unset / short → this module
// returns null and the adapter uses the real YouTube IFrame API. There is no test surface
// in production. The module is DOM-free at import (pure), so tsc / vitest / next build see
// no window.

import type {
  YtPlayerCallbacks,
  YtPlayerFactory,
  YtPlayerHandle,
} from "@/lib/player/adapters/youtube";

// A strong flag must be at least this long to arm the fake — the same floor the robot
// door enforces, so a stray/short value can never accidentally arm a test engine.
export const FAKE_ENGINE_MIN_LENGTH = 32;

// Is the fake armed on this build? True only when the public flag is a strong value.
// Read from process.env so Next inlines it into the client bundle at build time; a
// production build without the var strips the fake to a no-op (returns null below).
export function fakeEngineEnabled(
  flag: string | undefined = process.env.NEXT_PUBLIC_E2E_FAKE_ENGINE,
): boolean {
  return typeof flag === "string" && flag.length >= FAKE_ENGINE_MIN_LENGTH;
}

// YT.PlayerState codes the fake emits, matching the real player so the adapter's
// toEngineState mapping is exercised unchanged.
const S_UNSTARTED = -1;
const S_ENDED = 0;
const S_PLAYING = 1;
const S_PAUSED = 2;

// A short, fixed duration so a spec can drive a whole track deterministically.
const FAKE_DURATION_SEC = 240;

// Build the visible box + JS clock for one fake player inside `target`. It advances its
// clock only while "playing", exactly like a real engine paused by the user.
function makeFakePlayer(
  target: HTMLElement,
  videoId: string,
  callbacks: YtPlayerCallbacks,
): YtPlayerHandle {
  const doc = target.ownerDocument;
  const box = doc.createElement("div");
  box.className = "fake-engine";
  box.setAttribute("data-fake-engine", videoId);
  box.style.width = "100%";
  box.style.height = "100%";
  box.style.display = "flex";
  box.style.alignItems = "center";
  box.style.justifyContent = "center";
  box.style.background = "#101014";
  box.style.color = "#8ab";
  box.style.fontSize = "11px";
  box.textContent = `fake · ${videoId}`;
  target.appendChild(box);

  let currentTime = 0;
  let duration = FAKE_DURATION_SEC;
  let playing = false;
  let destroyed = false;
  let lastTickMs = now();
  let clockId: ReturnType<typeof setInterval> | null = null;

  function now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  function emit(state: number): void {
    if (!destroyed) callbacks.onStateChange(state);
  }

  function startClock(): void {
    if (clockId != null) return;
    lastTickMs = now();
    clockId = setInterval(() => {
      if (destroyed || !playing) return;
      const t = now();
      currentTime += (t - lastTickMs) / 1000;
      lastTickMs = t;
      if (currentTime >= duration) {
        currentTime = duration;
        playing = false;
        emit(S_ENDED);
        stopClock();
      }
    }, 100);
  }

  function stopClock(): void {
    if (clockId != null) {
      clearInterval(clockId);
      clockId = null;
    }
  }

  // The real factory resolves after onReady; mirror that so load() completes.
  emit(S_UNSTARTED);
  callbacks.onReady();

  return {
    playVideo() {
      if (destroyed) return;
      playing = true;
      lastTickMs = now();
      startClock();
      emit(S_PLAYING);
    },
    pauseVideo() {
      if (destroyed) return;
      playing = false;
      emit(S_PAUSED);
    },
    seekTo(seconds) {
      currentTime = Math.max(0, Math.min(duration, seconds));
    },
    setVolume() {},
    setPlaybackRate() {},
    loadVideoById(id) {
      // A real reuse: same player, new video, clock reset — NEVER a reload of the host.
      box.setAttribute("data-fake-engine", id);
      box.textContent = `fake · ${id}`;
      currentTime = 0;
      duration = FAKE_DURATION_SEC;
      playing = true;
      lastTickMs = now();
      startClock();
      emit(S_PLAYING);
    },
    cueVideoById(id) {
      box.setAttribute("data-fake-engine", id);
      currentTime = 0;
      playing = false;
      emit(S_UNSTARTED);
    },
    getCurrentTime() {
      return currentTime;
    },
    getDuration() {
      return duration;
    },
    destroy() {
      destroyed = true;
      playing = false;
      stopClock();
      if (box.parentElement) box.parentElement.removeChild(box);
    },
  };
}

// The factory the youtube adapter uses when the fake is armed, else null (real engine).
export function fakeEngineFactory(): YtPlayerFactory | null {
  if (!fakeEngineEnabled()) return null;
  return async (target, videoId, callbacks) => makeFakePlayer(target, videoId, callbacks);
}
