"use client";

// Media Session bridge — a headless client component mounted once in the shell.
//
// It is the ONLY place `navigator.mediaSession` is touched. All of the judgement (what
// metadata a track deserves, which state to publish, which store call each OS button maps
// to) lives in lib/player/media-session.ts as pure functions; this file is the thin
// browser shell around them, so the untestable part stays as small as possible.
//
// Everything here is defensive by design. Media Session is absent on the server, absent in
// some browsers, and partially implemented in others (Safari has historically thrown on
// `setPositionState` and on unknown action names). A missing lock-screen button must never
// take down playback, so every call is feature-detected and each action handler is
// registered in its own try/catch — a browser that rejects `seekto` still gets play, pause,
// next and previous.

import { useEffect } from "react";
import { playerStore } from "@/lib/player/store";
import {
  buildMediaMetadata,
  buildMediaSessionBindings,
  buildPositionState,
  hasMediaSession,
  mediaPlaybackState,
} from "@/lib/player/media-session";

export default function MediaSessionBridge() {
  useEffect(() => {
    if (!hasMediaSession()) return;
    const session = navigator.mediaSession;

    for (const { action, handler } of buildMediaSessionBindings(playerStore)) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // This browser does not know this action. Skipping it keeps the rest wired.
      }
    }

    // Only push metadata when the TRACK changes. The position tick fires a store update
    // roughly twice a second, and rebuilding MediaMetadata that often makes some platforms
    // re-fetch the artwork and flicker the lock screen.
    let publishedTrackKey: string | null = null;

    const publish = () => {
      const state = playerStore.getState();
      const key = state.current ? `${state.current.source}:${state.current.nativeId}` : null;
      if (key !== publishedTrackKey) {
        publishedTrackKey = key;
        const metadata = buildMediaMetadata(state.current);
        try {
          session.metadata = metadata ? new window.MediaMetadata(metadata) : null;
        } catch {
          // MediaMetadata missing or unhappy with the artwork: the OS panel simply keeps
          // whatever it had. Never worth interrupting playback over.
        }
      }
      try {
        session.playbackState = mediaPlaybackState(state);
      } catch {
        /* playbackState unsupported — the OS falls back to guessing from the audio */
      }
      const position = buildPositionState(state);
      if (position && typeof session.setPositionState === "function") {
        try {
          session.setPositionState(position);
        } catch {
          // Thrown when position briefly exceeds duration mid-track-change; the next tick
          // reports a consistent pair, so there is nothing to fix here.
        }
      }
    };

    const unsubscribe = playerStore.subscribe(publish);
    publish();

    return () => {
      unsubscribe();
      // Hand the OS panel back rather than leaving a dead "now playing" pointing at a
      // page that is gone: clear the handlers and the metadata on unmount.
      for (const { action } of buildMediaSessionBindings(playerStore)) {
        try {
          session.setActionHandler(action, null);
        } catch {
          /* nothing to unregister */
        }
      }
      try {
        session.metadata = null;
        session.playbackState = "none";
      } catch {
        /* already gone */
      }
    };
  }, []);

  return null;
}
